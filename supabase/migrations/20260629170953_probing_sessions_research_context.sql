-- probing_sessions — 사용자가 우패널 입력 패널에 적은 **조사 컨텍스트** 영속화.
--
-- PR (probing-question-thinking-flow): 프로빙 우패널이 단일 질문 list 에서
-- 4-layer (입력 / AI thinking / popup / history) 로 재편되면서, 사용자가 입력
-- 한 (1) 조사 목적, (2) 핵심 가설 list, (3) Key Research Question 을 새로
-- 고침 / 다른 디바이스 / 모달 close-reopen 사이에 보존해야 한다.
--
-- 모델: **per-user single row** — 한 사용자의 "현재 작업 중인 조사 컨텍스트"
-- 는 한 묶음이라는 단순화. 인터뷰 여러 건을 동시 진행하는 흐름은 현재 위젯
-- 모델 (한 번에 한 세션) 과 정합. 사용자가 새 인터뷰를 시작할 때 컨텍스트를
-- 교체하면 같은 row 가 upsert 된다. 다중 인터뷰 보존 (project / 인터뷰 id
-- 단위 분리) 은 후속 PR.
--
-- guide 입력 (기존 localStorage 의 interview_guide) 와 별개의 컬럼들 — 이번
-- PR 은 가이드 텍스트를 폐기하지 않고 새 3 필드를 추가하는 비파괴 변경.

create table if not exists public.probing_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A. 조사 목적 — 이 인터뷰로 알고자 하는 것 (1~2 문장).
  research_goal text not null default '',
  -- B. 핵심 가설 list — Postgres text[] 로 한 줄씩 보존. UI 의 ChipInput 이
  --    Enter 로 분리해 누적. 비어 있어도 OK (사용자가 가설 없이 RQ 만 가능).
  hypotheses text[] not null default array[]::text[],
  -- C. Key Research Question — 이 인터뷰가 답해야 할 핵심 질문.
  key_research_question text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- per-user single row — user_id 가 UNIQUE 라 upsert 가 단순.
-- org membership 이 바뀔 가능성 있어 (사용자가 다른 org 로 이동) org_id 는
-- 그때 같이 갱신되도록 row 자체는 user 단위로 유지.
create unique index if not exists probing_sessions_user_unique
  on public.probing_sessions (user_id);

alter table public.probing_sessions enable row level security;

-- 본인만 select / insert / update / delete.
drop policy if exists "probing_sessions_own_select" on public.probing_sessions;
create policy "probing_sessions_own_select" on public.probing_sessions
  for select using (user_id = auth.uid());

drop policy if exists "probing_sessions_own_insert" on public.probing_sessions;
create policy "probing_sessions_own_insert" on public.probing_sessions
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

drop policy if exists "probing_sessions_own_update" on public.probing_sessions;
create policy "probing_sessions_own_update" on public.probing_sessions
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

drop policy if exists "probing_sessions_own_delete" on public.probing_sessions;
create policy "probing_sessions_own_delete" on public.probing_sessions
  for delete using (user_id = auth.uid());

-- updated_at auto-bump on update.
create or replace function public.probing_sessions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists probing_sessions_updated_at on public.probing_sessions;
create trigger probing_sessions_updated_at
  before update on public.probing_sessions
  for each row execute function public.probing_sessions_set_updated_at();
