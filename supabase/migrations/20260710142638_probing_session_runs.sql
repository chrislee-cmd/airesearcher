-- probing_session_runs — 프로빙 세션 실행(run) 라이프사이클 계측 (OBS-2).
--
-- 기존 테이블과의 구분:
--   - `probing_sessions`   = 유저당 1행. research context(goal/KRQ/persona)
--                            upsert 저장용 — 세션 run 이 아니다.
--   - `probing_questions`  = 질문 행. 세션 경계·시작·종료 없음.
-- ⇒ "몇 명이 세션을 시작하고 / 완료하고 / 중도 이탈했나" 를 계측할 테이블이
--    없어 대시보드 "프로빙 세션 퍼널" 이 불가시였다. 이 테이블이 그 공백을 메운다.
--
-- 한 row = 한 세션 run. use-realtime-transcription 이 시작 시 POST
-- /api/probing/sessions 로 서버가 발급하는 session_id (realtime 세션 UUID)
-- 를 그대로 run 식별자로 쓴다 — 별도 run id 를 새로 만들지 않는다.
--   - #554(세션 녹음)의 session_id 개념과 정합 (같은 id 재사용, 중복 테이블 금지).
--   - 이 session_id 는 start-lump credit 의 generation_id 이기도 하다
--     (route.ts). 따라서 credit_transactions(generation_id, reason='feature_use')
--     와 그대로 교차검증 가능 — 별도 컬럼 불필요.
--
-- 라이프사이클:
--   - 시작(신규 start, renewal 아님) → status='active' row insert.
--   - 정상 종료(stop) → status='ended' + ended_at + duration_seconds + question_count.
--   - 에러 종료 → status='error' + ended_at.
--   - 이탈(탭 닫힘/크래시로 stop 미발화) → row 가 'active' 로 남는다
--     = 퍼널의 "미완료(이탈)" 버킷. renewal 은 같은 session_id 재전송이라
--     신규 insert 를 하지 않는다 (route.ts 가 renewId 로 구분).

create table if not exists public.probing_session_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- realtime 세션 UUID = start-lump generation_id. run 의 자연 키.
  -- renewal 재전송이 새 row 를 만들지 않게 unique.
  session_id uuid not null unique,
  -- 세션 상태. 'active' = 진행 중(또는 이탈로 방치), 'ended' = 정상 종료,
  -- 'error' = 시작/연결 실패로 종료.
  status text not null default 'active'
    check (status in ('active', 'ended', 'error')),
  -- 캡처 소스 — 시작 시 확정. 'mic' | 'tab'. 시작 payload 누락 시 null.
  source text check (source in ('mic', 'tab')),
  -- 세션 동안 이 유저가 생성한 probing_questions 수 (종료 시 서버 집계).
  question_count integer not null default 0,
  -- 세션 길이(초) — 종료 시 started_at 기준 서버 계산.
  duration_seconds integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- "지난 N일 세션 시작 유저 / 완료율" 이 유일한 read pattern. RLS 가 user_id
-- 로 gate 하므로 user_id 를 첫 컬럼으로.
create index if not exists probing_session_runs_user_started_idx
  on public.probing_session_runs (user_id, started_at desc);

-- 퍼널 집계(status 별 count)용.
create index if not exists probing_session_runs_status_idx
  on public.probing_session_runs (status);

alter table public.probing_session_runs enable row level security;

-- 본인 row 만 select / insert / update. probing_questions 의 RLS 패턴과 동일.
-- insert 는 org membership 검사를 추가해 forged payload 도 차단.
-- delete 는 열지 않는다 — 계측 row 는 사용자가 지울 이유가 없다.
drop policy if exists "probing_session_runs_own_select" on public.probing_session_runs;
create policy "probing_session_runs_own_select" on public.probing_session_runs
  for select using (user_id = auth.uid());

drop policy if exists "probing_session_runs_own_insert" on public.probing_session_runs;
create policy "probing_session_runs_own_insert" on public.probing_session_runs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

-- 종료 시 status/ended_at/duration/question_count 갱신. 본인 row 만.
drop policy if exists "probing_session_runs_own_update" on public.probing_session_runs;
create policy "probing_session_runs_own_update" on public.probing_session_runs
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
