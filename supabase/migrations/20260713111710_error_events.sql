-- 20260713111710_error_events.sql
--
-- 중앙 에러 관측 Phase 1 — 소스 계층 (docs/error-observability.md).
--
-- 제품 전체의 에러를 signature 로 dedup 해 담는 단일 소스. 앱 catch(logError),
-- 위젯 job-fail 스윕, DB 로그 폴링(Management API) — 세 인제스트 경로가 모두
-- 이 한 테이블로 모인다. 후속 Phase 2(이메일 digest)·Phase 3(incident 메모)는
-- 이 테이블의 open 행을 각자 자기 마커(alerted_at / memoized_at)로 소진한다.
--
-- 설계 근거:
--   - signature = hash(feature + code + normalized(message)). 같은 원인의 재발은
--     신규 행이 아니라 기존 행의 count++/last_seen 갱신 → occurrence flood 가
--     행 하나로 collapse (메모/이메일 flood 방지). message 정규화(숫자/UUID/
--     타임스탬프 마스킹)는 앱(log-error.ts)이 담당하고, 여기선 signature 를
--     그대로 받아 upsert 만 한다.
--   - alerted_at(이메일, prod cron)·memoized_at(메모, local 스윕) 이중 마커로
--     같은 error_event 를 두 소비자가 독립적으로 dedup.
--
-- 전부 additive(create table/index if not exists + create or replace function) +
-- idempotent → 머지 시 자동 적용(PROJECT.md §7.5) 안전 게이트를 통과한다.

-- ── 1. error_events 테이블 ───────────────────────────────────────────────────
create table if not exists public.error_events (
  id          uuid primary key default gen_random_uuid(),
  -- hash(feature + code + normalized message). 같은 원인 = 같은 시그니처 = 한 행.
  signature   text not null unique,
  -- widgetHealth 키(admin/analytics.ts)와 정합: 'interview'|'billing'|'desk'|'db'|...
  feature     text not null,
  -- 세분 코드: 'chunk_insert_failed'|'statement_timeout'|'checkout_503'|...
  code        text,
  -- 대표 메시지 — 정규화 전 원문 1건(가장 최근에 본 것을 보관).
  message     text,
  -- 샘플 컨텍스트: id/route/org 등. PII 최소화(샘플 1건).
  context     jsonb,
  severity    text not null default 'error',   -- 'error'|'warn'
  source      text not null,                   -- 'app'|'db-poll'|'job-sweep'
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  count       int not null default 1,
  alerted_at  timestamptz,                     -- 이메일 digest dedup (Phase 2, prod)
  memoized_at timestamptz,                     -- incident 메모 dedup (Phase 3, local)
  resolved_at timestamptz
);

-- 미해결(open) 행을 최근순으로 — digest/메모 스윕의 주 쿼리 경로.
create index if not exists error_events_open_idx
  on public.error_events (last_seen desc)
  where resolved_at is null;

-- ── 2. record_error_event RPC (원자적 upsert, 멱등) ─────────────────────────
-- 같은 signature 재발 → 신규 행을 만들지 않고 count++/last_seen 갱신. 재발 시
-- message/context 는 최신 샘플로 덮고(원인 추적엔 최근 표본이 유용), first_seen 은
-- 보존한다. 재발이 resolved 상태였다면 다시 open 으로 되살린다(회귀 재발 감지).
-- alerted_at/memoized_at 은 여기서 건드리지 않는다 — 소비자(cron/스윕)만 스탬프.
--
-- 반환값 = 영향받은 행의 id. 앱은 이 값을 신경 쓸 필요 없다(best-effort).
create or replace function public.record_error_event(
  p_signature text,
  p_feature   text,
  p_code      text default null,
  p_message   text default null,
  p_context   jsonb default null,
  p_severity  text default 'error',
  p_source    text default 'app'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.error_events (
    signature, feature, code, message, context, severity, source
  ) values (
    p_signature, p_feature, p_code, p_message, p_context,
    coalesce(p_severity, 'error'), coalesce(p_source, 'app')
  )
  on conflict (signature) do update
    set count       = public.error_events.count + 1,
        last_seen   = now(),
        message     = coalesce(excluded.message, public.error_events.message),
        context     = coalesce(excluded.context, public.error_events.context),
        severity    = excluded.severity,
        -- resolved 였던 시그니처가 재발하면 다시 open (회귀 재발).
        resolved_at = null
  returning id into v_id;

  return v_id;
end $$;

-- 쓰기는 service_role(및 이 security-definer RPC)만. 앱/익명은 직접 호출 불가.
revoke all on function public.record_error_event(text, text, text, text, jsonb, text, text) from public;
revoke all on function public.record_error_event(text, text, text, text, jsonb, text, text) from anon, authenticated;
grant execute on function public.record_error_event(text, text, text, text, jsonb, text, text) to service_role;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- 쓰기는 service_role(RPC 경유, RLS 우회)만. 읽기는 super-admin 대시보드용.
-- JWT email 클레임 게이트 — authenticated 롤은 auth.users SELECT 권한이 없어
-- 서브쿼리는 실패하므로 `auth.jwt() ->> 'email'` 을 쓴다(landing_visits 선례).
alter table public.error_events enable row level security;

drop policy if exists "error_events_super_admin_read" on public.error_events;
create policy "error_events_super_admin_read" on public.error_events
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );
