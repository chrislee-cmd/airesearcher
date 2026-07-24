// 중앙 에러 관측 Phase 1 — DB 로그 폴링 cron (docs/error-observability.md §4).
//
// 앱 catch(logError) 로는 못 잡는 **DB 계층 에러**를 커버한다: `column ... does
// not exist`(recruiting-flood 류)·`canceling statement due to statement timeout`
// 처럼 PostgREST 이전/이후에서 터지거나 fire-and-forget 쿼리에서 나는 에러는
// 앱 코드에 catch 지점이 없다. Supabase Management API 의 로그 엔드포인트로 최근
// postgres 에러 로그를 주기 조회 → 정규화 → error_events 로 upsert 한다.
//
// 의존성: Management API 는 Supabase PAT(env SUPABASE_ACCESS_TOKEN) + project ref
// 를 요구한다. 토큰이 없으면 이 파트는 조용히 no-op 하고 self-observation 만
// 남긴다(logError feature='observability'). 프로젝트 ref 는 NEXT_PUBLIC_SUPABASE_URL
// 에서 파생.
//
// 워터마크(중복 적재 방지): 마지막 폴링 시각을 error_events 안의 **sentinel 행**
// (reserved signature, code='__db_poll_watermark__', resolved_at 고정 → open 쿼리에
// 안 잡힘)의 context.until 에 저장한다. 매 폴링은 (watermark, now] 창만 조회하는
// tumbling window — 겹치지 않아 occurrence 재집계가 없다. 최초 실행은 watermark
// 가 없으므로 최근 POLL_WINDOW 만 본다.
//
// Auth: 표준 Vercel cron 패턴 — Authorization: Bearer <CRON_SECRET>, fail-closed.

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { logError, computeSignature } from '@/lib/observability/log-error';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 최초 실행(워터마크 없음)에서 되돌아볼 창.
const POLL_WINDOW_MINUTES = 15;
// 한 폴링에서 처리할 로그 행 상한.
const LOG_LIMIT = 200;

// 워터마크 sentinel 행의 예약 시그니처. 실제 에러가 아니므로 resolved 로 고정해
// open 소비자(Phase 2/3)에서 배제한다.
const WATERMARK_SIGNATURE = computeSignature({
  feature: 'observability',
  code: '__db_poll_watermark__',
  message: 'db-poll watermark',
});

type Admin = ReturnType<typeof createAdminClient>;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

// https://<ref>.supabase.co → <ref>. 파싱 실패 시 null.
function projectRef(): string | null {
  try {
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
    const ref = host.split('.')[0];
    return ref && ref !== 'localhost' ? ref : null;
  } catch {
    return null;
  }
}

// postgres 에러 메시지 → 안정적인 code 축(원인 grouping). message 자체의 가변
// 토큰 마스킹은 signature 계산(normalizeMessage)이 담당하므로 여기선 코스 분류만.
function classifyDbError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('statement timeout') || m.includes('canceling statement')) return 'statement_timeout';
  if (m.includes('does not exist')) return 'undefined_object';
  if (m.includes('duplicate key')) return 'unique_violation';
  if (m.includes('deadlock')) return 'deadlock_detected';
  if (m.includes('permission denied')) return 'permission_denied';
  if (m.includes('out of memory')) return 'out_of_memory';
  if (m.includes('connection') && m.includes('too many')) return 'too_many_connections';
  return 'postgres_error';
}

// ── 운영자/ad-hoc SQL 출처 필터 (팬텀 인시던트 제거) ──
// 대시보드 SQL 에디터·MCP·로컬 psql 등 **사람이 직접 돌린** 쿼리의 오류(오타
// `column does not exist` 등)는 앱 유발 인시던트가 아니다. 이런 출처만 error_events
// 적재에서 배제한다.
//
// 방향 = **블랙리스트 우선(보수적)**: 앱 출처를 화이트리스트로 좁히면 새 앱 롤/
// pooler 변경 시 진짜 오류를 놓칠 위험이 크다. 대신 "알려진 운영자 출처"만 배제하고
// 매칭 안 되면 적재를 유지한다. user_name 이 1차 신호(가장 안정적) — 앱 런타임은
// PostgREST/Supavisor 를 통해 authenticator/anon/authenticated/service_role 롤로만
// 접속하고, `cli_login_postgres` 는 대시보드 로그인 전용 롤이라 앱 트래픽과 안 겹친다.
// application_name 은 보조 신호(대화형 클라이언트 식별).
const OPERATOR_DB_USERS = new Set([
  'cli_login_postgres', // Supabase 대시보드 SQL 에디터 로그인 롤
]);
const OPERATOR_APP_NAME_PATTERNS = [
  'supabase dashboard',
  'mcp',
  'psql',
  'pgadmin',
  'dbeaver',
  'tableplus',
  'datagrip',
  'postico',
];

// 이 로그 행이 운영자/ad-hoc 커넥션에서 왔는가. 애매하면 false(=적재 유지).
function isOperatorConnection(userName: string, appName: string): boolean {
  if (OPERATOR_DB_USERS.has(userName.toLowerCase())) return true;
  const a = appName.toLowerCase();
  return a !== '' && OPERATOR_APP_NAME_PATTERNS.some((p) => a.includes(p));
}

async function readWatermark(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from('error_events')
    .select('context')
    .eq('signature', WATERMARK_SIGNATURE)
    .maybeSingle();
  const ctx = data?.context as { until?: string } | null | undefined;
  return ctx?.until ?? null;
}

// 워터마크를 직접 upsert(RPC 우회 — count 인플레 방지). resolved_at 고정으로
// open 소비자에서 배제, severity='warn'.
async function writeWatermark(admin: Admin, until: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin.from('error_events').upsert(
    {
      signature: WATERMARK_SIGNATURE,
      feature: 'observability',
      code: '__db_poll_watermark__',
      message: 'db-poll watermark (internal)',
      context: { until },
      severity: 'warn',
      source: 'db-poll',
      last_seen: nowIso,
      resolved_at: nowIso,
    },
    { onConflict: 'signature' },
  );
}

// Management API logs 엔드포인트로 (start, end] 창의 postgres 에러 로그 조회.
// 반환: { message, timestamp, userName, appName } 배열. 실패/미설정 시 throw →
// 상위에서 self-log. userName/appName 은 커넥션 출처 필터(운영자/ad-hoc SQL 노이즈
// 배제)에 쓰인다.
async function fetchPostgresErrorLogs(
  ref: string,
  token: string,
  startIso: string,
  endIso: string,
): Promise<{ message: string; timestamp: string; userName: string; appName: string }[]> {
  // postgres_logs 소스에서 ERROR/FATAL/PANIC 레벨만. metadata→parsed 언네스트는
  // Supabase 로그(Logflare/BigQuery 백엔드) 표준 스키마. user_name/application_name
  // 은 커넥션 출처 — 운영자(대시보드 `cli_login_postgres`·MCP) vs 앱 런타임 구분용.
  const sql = `
    select
      t.timestamp as timestamp,
      event_message as message,
      parsed.error_severity as severity,
      parsed.user_name as user_name,
      parsed.application_name as application_name
    from postgres_logs as t
    cross join unnest(t.metadata) as m
    cross join unnest(m.parsed) as parsed
    where parsed.error_severity in ('ERROR','FATAL','PANIC')
    order by t.timestamp desc
    limit ${LOG_LIMIT}
  `.trim();

  const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all`);
  url.searchParams.set('sql', sql);
  url.searchParams.set('iso_timestamp_start', startIso);
  url.searchParams.set('iso_timestamp_end', endIso);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`management_api_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    result?: {
      message?: string;
      timestamp?: string | number;
      user_name?: string | null;
      application_name?: string | null;
    }[];
  };
  const rows = json.result ?? [];
  return rows
    .map((r) => ({
      message: typeof r.message === 'string' ? r.message : '',
      // logs API 는 timestamp 를 마이크로초 epoch(숫자) 또는 ISO 로 줄 수 있다.
      timestamp:
        typeof r.timestamp === 'number'
          ? new Date(r.timestamp / 1000).toISOString()
          : String(r.timestamp ?? ''),
      userName: typeof r.user_name === 'string' ? r.user_name : '',
      appName: typeof r.application_name === 'string' ? r.application_name : '',
    }))
    .filter((r) => r.message);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  if (!token || !ref) {
    // 토큰/ref 미설정 → 이 파트 no-op. self-observation 만 남긴다(무음 방지).
    await logError({
      feature: 'observability',
      code: 'db_poll_unconfigured',
      message: `db-log-poll skipped (token=${token ? 'set' : 'missing'} ref=${ref ?? 'missing'})`,
      severity: 'warn',
      source: 'db-poll',
    });
    return NextResponse.json({ ok: true, polled: false, reason: 'unconfigured' });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  let startIso: string;
  try {
    const watermark = await readWatermark(admin);
    startIso = watermark ?? new Date(Date.now() - POLL_WINDOW_MINUTES * 60_000).toISOString();
  } catch {
    startIso = new Date(Date.now() - POLL_WINDOW_MINUTES * 60_000).toISOString();
  }

  let logs: { message: string; timestamp: string; userName: string; appName: string }[];
  try {
    logs = await fetchPostgresErrorLogs(ref, token, startIso, nowIso);
  } catch (e) {
    // Management API 오류(권한/스키마/네트워크) — self-observation, 기능 안 깸.
    await logError({
      feature: 'observability',
      code: 'db_poll_failed',
      message: e instanceof Error ? e.message : 'db_poll_failed',
      severity: 'warn',
      source: 'db-poll',
    });
    return NextResponse.json({ ok: true, polled: false, reason: 'api_error' }, { status: 200 });
  }

  // 각 에러 로그를 error_events 로 적재. 같은 원인은 signature 로 collapse → count.
  // 단, 운영자/ad-hoc 커넥션(대시보드·MCP·psql)에서 온 오류는 팬텀 인시던트라 배제.
  let ingested = 0;
  let filtered = 0;
  const filteredSample: { user: string; app: string; message: string }[] = [];
  for (const row of logs) {
    if (isOperatorConnection(row.userName, row.appName)) {
      filtered += 1;
      // 완전 소실 방지 — 앞 3건만 표본으로 남겨 "관측의 관측" 카운터에 첨부.
      if (filteredSample.length < 3) {
        filteredSample.push({
          user: row.userName || '(none)',
          app: row.appName || '(none)',
          message: row.message.slice(0, 120),
        });
      }
      continue;
    }
    await logError({
      feature: 'db',
      code: classifyDbError(row.message),
      message: row.message,
      context: { log_timestamp: row.timestamp },
      severity: 'error',
      source: 'db-poll',
    });
    ingested += 1;
  }

  // 필터 아웃된 항목의 관측 — per-노이즈 행 대신 집계 1행(severity=warn → feature
  // 'observability' 이므로 이메일 digest 에서 이중 배제, 팬텀 인시던트 안 됨).
  if (filtered > 0) {
    await logError({
      feature: 'observability',
      code: 'db_poll_operator_filtered',
      message: `db-poll filtered ${filtered} operator/ad-hoc SQL error log(s)`,
      context: { filtered, sample: filteredSample },
      severity: 'warn',
      source: 'db-poll',
    });
  }

  // 워터마크 전진 — 다음 폴링은 이 시각 이후만(tumbling, 중복 적재 방지).
  try {
    await writeWatermark(admin, nowIso);
  } catch {
    // 워터마크 저장 실패 시 다음 폴링이 겹칠 수 있으나(count 소폭 인플레) 기능엔
    // 무해 — best-effort.
  }

  return NextResponse.json({
    ok: true,
    polled: true,
    ingested,
    filtered,
    scanned: logs.length,
    window: { start: startIso, end: nowIso },
  });
}
