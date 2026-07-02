-- 인터뷰 V2 데이터 모델 — schema only (첫 V2 spec).
--
-- V2 는 인터뷰 문서를 **프로젝트 단위**로 묶고, 프로젝트(또는 cross-project)
-- 범위의 자연어 검색을 history/audit 로 남긴다. 사용자 결정(2026-07-02):
-- 옛 InterviewAnalyzer 계열(interview_documents / interview_chunks / matrix)
-- 은 유지하고, 그 위에 V2 구조를 비파괴로 얹는다.
--
--   1. interview_projects       (신규) — 문서 그룹 단위.
--   2. interview_documents.project_id  (컬럼 추가, nullable)
--        - null = legacy(프로젝트 미지정) 문서. cross-project 조회도 허용.
--        - on delete set null = 프로젝트 삭제해도 문서는 보존.
--   3. interview_search_queries (신규) — 검색 질의 + 답변 + citation 로그.
--        - project_id null = cross-project 검색.

-- 1. interview_projects ------------------------------------------------------
create table if not exists public.interview_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_projects_org_user_updated_idx
  on public.interview_projects (org_id, user_id, updated_at desc);

alter table public.interview_projects enable row level security;

-- 본인 소유 row 만 rw.
drop policy if exists "own project rw" on public.interview_projects;
create policy "own project rw" on public.interview_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- updated_at auto-bump — (org_id, user_id, updated_at desc) 인덱스 정렬 유지용.
create or replace function public.interview_projects_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists interview_projects_updated_at on public.interview_projects;
create trigger interview_projects_updated_at
  before update on public.interview_projects
  for each row execute function public.interview_projects_set_updated_at();

-- 2. interview_documents.project_id -----------------------------------------
-- nullable — legacy(프로젝트 미지정) + cross-project 지원.
alter table public.interview_documents
  add column if not exists project_id uuid
    references public.interview_projects(id) on delete set null;

create index if not exists interview_documents_project_id_idx
  on public.interview_documents (project_id);

-- 3. interview_search_queries ------------------------------------------------
create table if not exists public.interview_search_queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.interview_projects(id) on delete set null,  -- null = cross
  question text not null,
  answer_md text,
  citations jsonb,
  created_at timestamptz not null default now()
);

create index if not exists interview_search_queries_user_created_idx
  on public.interview_search_queries (user_id, created_at desc);

alter table public.interview_search_queries enable row level security;

-- 본인 소유 row 만 rw.
drop policy if exists "own query rw" on public.interview_search_queries;
create policy "own query rw" on public.interview_search_queries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
