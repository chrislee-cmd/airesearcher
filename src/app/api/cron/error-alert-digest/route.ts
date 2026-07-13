// 중앙 에러 관측 Phase 2 — 전제품 에러 digest cron (docs/error-observability.md §Phase2).
//
// Phase 1(#1015)이 깐 error_events 소스 계층(logError + widget-sweep + db-poll)의
// **소비자(delivery) 계층**이다. #1008(interview-failure-alert)이 인터뷰 전용으로
// 하던 이메일 알림을, error_events 기반 **전제품 digest** 로 일반화한다. 관측 루프
// "fail → 적재 → 전달" 을 닫는 마지막 조각.
//
// 동작:
//   - error_events 중 **alerted_at IS NULL AND resolved_at IS NULL**(신규/미해결
//     incident)만 조회 → 있으면 **1 run = 1 이메일**(N incident 묶음) → 보고한
//     행에 alerted_at=now() 스탬프(dedup: 다음 스윕이 재알림 안 함).
//   - 정렬: count desc, last_seen desc(급증 incident 상단). 표시 cap(MAX_ROWS,
//     초과 "+M건") — anti-storm(1 run = 1 메일). 넘친 행은 alerted_at NULL 로 남아
//     다음 스윕이 소진.
//   - 필터: severity='error' 만(warn 제외), feature<>'observability'(내부 워터마크/
//     self-observation 행 제외). resolved 워터마크 sentinel 은 resolved_at 으로도
//     이미 배제됨.
//
// 발송: #1008 의 nodemailer + Gmail SMTP 경로 그대로 재사용(앱은 Resend SDK 를
// 직접 안 씀 — Resend 는 Supabase auth 메일용 custom SMTP, PROJECT.md §8.1).
// 수신자: ERROR_ALERT_EMAILS → (하위호환) INTERVIEW_ALERT_EMAILS → 슈퍼어드민.
//
// Auth: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed.
// service_role(createAdminClient) — 세션 없음, RLS 우회.

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { superAdminEmails } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 한 이메일에 표시할 incident 상한. 초과분은 "+N건" 으로 요약하고 alerted_at 을
// NULL 로 남겨 다음 스윕이 소진(여전히 1 run = 1 메일 — anti-storm).
const MAX_ROWS_IN_EMAIL = 40;
// 한 스윕에서 끌어올 open incident 상한(백로그가 쿼리를 부풀리지 않게).
const QUERY_LIMIT = 200;
// 이 count 이상인 incident 는 급증으로 보고 상단에 🔥 강조.
const SURGE_COUNT = 50;

type OpenIncident = {
  id: string;
  signature: string;
  feature: string;
  code: string | null;
  message: string | null;
  context: Record<string, unknown> | null;
  severity: string;
  source: string;
  first_seen: string;
  last_seen: string;
  count: number;
};

const SELECT_COLS =
  'id, signature, feature, code, message, context, severity, source, first_seen, last_seen, count';

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

// 수신자 SSOT: ERROR_ALERT_EMAILS(신규) 우선 → INTERVIEW_ALERT_EMAILS(하위호환,
// #1008 의 env) → 슈퍼어드민 allowlist. 각 env 는 comma-separated, 공백/빈값 제거.
function alertRecipients(): string[] {
  for (const raw of [env.ERROR_ALERT_EMAILS, env.INTERVIEW_ALERT_EMAILS]) {
    if (!raw) continue;
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return superAdminEmails();
}

// 파운더용 링크 — 배포 해시(preview)보다 canonical 도메인(prod) 우선.
function baseUrl(): string {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

// context 샘플에서 한 줄 요약(있으면). PII 최소 — 대표 식별자만.
function contextSummary(context: Record<string, unknown> | null): string | null {
  if (!context || typeof context !== 'object') return null;
  const keys = ['sample_id', 'table', 'route', 'org_id', 'project_id', 'log_timestamp'];
  const parts: string[] = [];
  for (const k of keys) {
    const v = (context as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // open + 미알림 + 실사용 error 만. warn(소음성 self-observation 등)과 내부
  // observability 행(워터마크 sentinel 은 resolved_at 으로도 이미 배제)은 제외.
  const { data: rows, error: queryErr } = await admin
    .from('error_events')
    .select(SELECT_COLS)
    .is('alerted_at', null)
    .is('resolved_at', null)
    .eq('severity', 'error')
    .neq('feature', 'observability')
    .order('count', { ascending: false })
    .order('last_seen', { ascending: false })
    .limit(QUERY_LIMIT);
  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const incidents = (rows ?? []) as OpenIncident[];
  const total = incidents.length;

  // 신규 incident 0건 → 무발송(무실패 무메일).
  if (total === 0) {
    return NextResponse.json({ ok: true, sent: false, incidents: 0 });
  }

  const displayed = incidents.slice(0, MAX_ROWS_IN_EMAIL);
  const overflow = total - displayed.length;

  const site = baseUrl();

  const lines = displayed.map((inc) => {
    const surge = inc.count >= SURGE_COUNT ? '🔥 ' : '';
    const code = inc.code ? ` · ${inc.code}` : '';
    const msg = inc.message?.trim() || '(message 없음)';
    const ctx = contextSummary(inc.context);
    const parts = [
      `• ${surge}[${inc.feature}${code}] ×${inc.count}`,
      `    ${msg}`,
      `    source: ${inc.source} · first_seen: ${inc.first_seen} · last_seen: ${inc.last_seen}`,
    ];
    if (ctx) parts.push(`    context: ${ctx}`);
    return parts.join('\n');
  });

  const totalOccurrences = displayed.reduce((sum, i) => sum + i.count, 0);
  const bodyParts: string[] = [
    `전제품 에러 관측에서 신규/미해결 incident ${total}건이 감지되었습니다.`,
    '',
    `요약: incident ${total}건 (표시 ${displayed.length}건, 누적 발생 ${totalOccurrences}회+)`,
    `대시보드: ${site}`,
    '',
    '── Incident (count 내림차순) ──',
    lines.join('\n'),
  ];
  if (overflow > 0) bodyParts.push(`  … 외 +${overflow}건 (다음 스윕에서 알림)`);
  bodyParts.push('', `digest_at: ${new Date().toISOString()}`);
  const text = bodyParts.join('\n');

  const subject = `🔴 에러 digest — incident ${total}건 (prod)`;

  // #1008 의 nodemailer + Gmail SMTP 발송 경로 그대로 재사용.
  const gmailUser = env.GMAIL_USER;
  const gmailPass = env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[error-alert-digest] GMAIL_USER or GMAIL_APP_PASSWORD missing');
    return NextResponse.json({ error: 'email_not_configured' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  try {
    await transporter.sendMail({
      from: `Research-Canvas <${gmailUser}>`,
      to: alertRecipients(),
      subject,
      text,
    });
  } catch (err) {
    // alerted_at 스탬프 안 함 — 다음 스윕이 재시도하도록 행을 미표시로 남긴다.
    console.error('[error-alert-digest] gmail smtp error', err);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  // dedup: 실제로 보고한 행만 스탬프. 넘친 행은 NULL 로 남아 다음 스윕이 소진.
  const stampedAt = new Date().toISOString();
  const displayedIds = displayed.map((i) => i.id);
  await admin.from('error_events').update({ alerted_at: stampedAt }).in('id', displayedIds);

  return NextResponse.json({
    ok: true,
    sent: true,
    incidents: total,
    reported: displayedIds.length,
    overflow,
  });
}
