-- probing_deliverables — 프로빙 per-세션 "완성 산출물" 레코드 (best-effort).
--
-- PR (probing-translate-persist-deliverable): 산출물 통합 에픽의 마지막 조각.
--
-- 배경 = 진짜 공백. 기존 테이블 어느 것도 "한 세션의 완성 산출물" 을 세션
-- 단위로 남기지 않는다:
--   - probing_sessions      = **per-user 1행** (research context + 공유 시점
--                             persona_snapshot). 새 세션이 같은 row 를 덮어씀.
--   - probing_session_runs  = 세션 라이프사이클 계측(duration/question_count)
--                             — reflection/questions 본문(스냅샷)은 없음.
--   - probing_questions     = 개별 질문 행 — 세션 경계 없음.
-- ⇒ 새로고침하면 라이브러리(GET /api/artifacts)에 올릴 세션 단위 레코드가
--    존재하지 않는다. 이 테이블이 그 공백을 메운다 — 세션 종료 시 현재
--    reflection + questions 를 스냅샷으로 1행 append.
--
-- 모델: **append-only, per-세션 1행** (probing_sessions 의 per-user upsert 와
-- 다르다). session_started_at = 그 run 의 시작 시각(probing_session_runs.started_at)
-- 이라 세션별로 구분된다. snapshot 은 probingPersonaSnapshotSchema
-- (src/lib/probing-persona-snapshot.ts) 와 동일 shape — 공유 스냅샷과 계약 공유.
--
-- write 는 **best-effort** — /api/probing/sessions/end 가 run 을 종료시킨 직후
-- 부수효과로 insert 한다. 실패해도 라이브 기능(스트리밍/질문 생성)에 무영향
-- (라우트가 try/catch 로 삼키고 run 종료 응답은 그대로 반환).

create table if not exists public.probing_deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 사람이 읽는 제목 — research_goal 앞 40자 파생 (없으면 "프로빙 세션 <날짜>").
  title text not null default '',
  -- 세션 스냅샷 (probingPersonaSnapshotSchema): reflection 패널 + 생성 질문.
  snapshot jsonb not null default '{}'::jsonb,
  -- 이 세션에서 생성된 질문 수 (probing_session_runs.question_count 미러).
  question_count integer not null default 0,
  -- 이 세션 run 의 시작 시각 (probing_session_runs.started_at). 세션 구분 축.
  session_started_at timestamptz,
  created_at timestamptz not null default now()
);

-- 본인 user 의 최신 N개 — 라이브러리 리스트의 유일한 read pattern.
-- RLS 가 user_id 로 gate 하므로 user_id 를 첫 컬럼으로.
create index if not exists probing_deliverables_user_created_idx
  on public.probing_deliverables (user_id, created_at desc);

alter table public.probing_deliverables enable row level security;

-- 본인만 select / insert / delete. probing_questions·probing_sessions 의 RLS
-- 패턴과 동일 (user 스코프 + insert 시 org membership 검사로 forged payload 차단).
drop policy if exists "probing_deliverables_own_select" on public.probing_deliverables;
create policy "probing_deliverables_own_select" on public.probing_deliverables
  for select using (user_id = auth.uid());

drop policy if exists "probing_deliverables_own_insert" on public.probing_deliverables;
create policy "probing_deliverables_own_insert" on public.probing_deliverables
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

drop policy if exists "probing_deliverables_own_delete" on public.probing_deliverables;
create policy "probing_deliverables_own_delete" on public.probing_deliverables
  for delete using (user_id = auth.uid());
