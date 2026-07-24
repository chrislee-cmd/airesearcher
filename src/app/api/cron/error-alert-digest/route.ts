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

// 하드 결제/크레딧(402) 시그니처 — 사용자 대면 기능(topline·translate·desk 등이
// 동일 `*_call_failed` 키 공유)이 전면 중단되는 최상위 심각도라, 일반 digest 뭉치기
// 에서 분리해 즉시 상단 승격한다(카드 #555). 판정: code 가 `*_call_failed` 이고
// (logError context 의 hard:true 마커 OR 메시지/코드가 결제·크레딧·402 계열).
// hard:true 마커가 1차 신호, 메시지 패턴은 마커 유실 대비 백업.
const HARD_BILLING_MSG_RE =
  /402|크레딧|결제|credit|billing|insufficient|payment|quota|balance/i;

function isHardBillingIncident(inc: OpenIncident): boolean {
  if (!inc.code || !/_call_failed$/.test(inc.code)) return false;
  const hardMarker = inc.context?.hard === true;
  const msgMatch = HARD_BILLING_MSG_RE.test(
    `${inc.message ?? ''} ${inc.code ?? ''}`,
  );
  return hardMarker || msgMatch;
}

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

  // ── 하드 결제/크레딧(402) 승격 (카드 #555) ──
  // 쿼리는 count desc 정렬이라 402 가 count 낮은 초기엔 하위에 묻힌다. 결제 소진은
  // 기능 전면 중단이라 count 와 무관하게 최상단·별도 섹션으로 올리고, 표시 cap 에서도
  // 항상 우선 확보한다(먼저 truncate 되지 않게). 나머지 incident 는 기존과 동일.
  const hardBilling = incidents.filter(isHardBillingIncident);
  const rest = incidents.filter((inc) => !isHardBillingIncident(inc));

  // 하드 결제는 항상 우선 표시분에 넣고, 남은 자리로 나머지를 채운다(합계 cap 유지).
  const hardShown = hardBilling.slice(0, MAX_ROWS_IN_EMAIL);
  const restShown = rest.slice(0, MAX_ROWS_IN_EMAIL - hardShown.length);
  const displayed = [...hardShown, ...restShown];
  const overflow = total - displayed.length;

  const site = baseUrl();

  const formatLine = (inc: OpenIncident): string => {
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
  };

  const totalOccurrences = displayed.reduce((sum, i) => sum + i.count, 0);
  const hasHardBilling = hardShown.length > 0;

  const bodyParts: string[] = [
    `전제품 에러 관측에서 신규/미해결 incident ${total}건이 감지되었습니다.`,
    '',
    `요약: incident ${total}건 (표시 ${displayed.length}건, 누적 발생 ${totalOccurrences}회+)`,
    `대시보드: ${site}`,
  ];

  // 결제/크레딧 소진은 별도 강조 섹션으로 최상단 승격(즉시 조치 안내 포함).
  if (hasHardBilling) {
    bodyParts.push(
      '',
      `🚨 즉시 조치 — 결제/크레딧 소진(402) ${hardShown.length}건`,
      '   AI 크레딧/결제 소진으로 사용자 대면 기능이 중단됐습니다. 재시도로 복구되지 않으니(자동 재시도 제외됨) Anthropic 크레딧을 충전하세요.',
      hardShown.map(formatLine).join('\n'),
    );
  }

  bodyParts.push(
    '',
    hasHardBilling
      ? '── 기타 Incident (count 내림차순) ──'
      : '── Incident (count 내림차순) ──',
  );
  if (restShown.length > 0) {
    bodyParts.push(restShown.map(formatLine).join('\n'));
  } else {
    bodyParts.push('  (기타 없음)');
  }
  if (overflow > 0) bodyParts.push(`  … 외 +${overflow}건 (다음 스윕에서 알림)`);
  bodyParts.push('', `digest_at: ${new Date().toISOString()}`);
  const text = bodyParts.join('\n');

  // 결제 소진이 섞여 있으면 제목에도 즉시 인지되게 prefix 승격.
  const subject = hasHardBilling
    ? `💳🔴 [결제/크레딧 소진] 에러 digest — incident ${total}건 (prod)`
    : `🔴 에러 digest — incident ${total}건 (prod)`;

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
