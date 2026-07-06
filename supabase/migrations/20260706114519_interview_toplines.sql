-- 인터뷰 탑라인 보고서 — 자동 생성 + 캐시 (Opus 생성 + 교차분석 + 인용).
--
-- 인터뷰 V2 프로젝트(interview_projects)의 업로드 문서 전체를 근거로 만든
-- 자동 탑라인 보고서를 프로젝트당 1건 영속한다. 우측 패널 탭1(후속 PR)의
-- 데이터 소스이자, drag-to-ask 삽입 병합 대상(blocks anchor)이다.
--
-- 사용자 확정 결정(2026-07-06):
--   1. 캐싱 — 한번 생성 후 저장, 재생성은 명시적(force). content_hash 가 캐시
--      키. 프로젝트 문서 셋(각 interview_documents.content_hash)의 해시라서
--      파일 추가/삭제 시 값이 바뀌어 stale 판정.
--   2. blocks — 단일 markdown 문자열이 아니라 블록 배열. 블록 id 가 안정
--      anchor 라 후속 drag-to-ask 가 "이 블록 아래 삽입"을 영속화할 수 있다.
--   3. 유지된 삽입 = 이 blocks 에 병합(inserted_qa 타입), 별도 레이어 X.
--   4. 인용 필수 — 각 블록의 citations 는 근거 chunk_id 배열.
--
-- RLS 는 org 스코프(has_org_role) — interview_documents / interview_chunks 와
-- 동일 컨벤션. 생성 write 는 admin client(RLS 우회)로 하지만, 후속 UI 의
-- 일반 client select 를 위해 viewer 정책을 둔다.

create table if not exists public.interview_toplines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.interview_projects(id) on delete cascade,
  -- 프로젝트 문서 셋의 해시 = 캐시 키. 현재 해시와 같고 status='done' 이면
  -- 캐시 히트(LLM 0). 다르면 stale → 재생성 경로.
  content_hash text not null,
  -- 블록 배열. 원소 shape(§문서 모델):
  --   { id, type: heading|paragraph|table|quote|insight|inserted_qa,
  --     md, citations: [chunk_id...], table?: { headers, rows } }
  blocks jsonb not null default '[]'::jsonb,
  status text not null default 'idle'
    check (status in ('idle', 'generating', 'done', 'error')),
  error_message text,
  -- 생성에 사용한 모델 (예: claude-opus-4-8) — 감사/디버깅용.
  model text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 프로젝트당 탑라인 1건 — 재생성은 upsert(overwrite). unique 로 캐시 조회를
-- (project_id) 단일 키로 단순화.
create unique index if not exists interview_toplines_project_uq
  on public.interview_toplines (project_id);

create index if not exists interview_toplines_org_idx
  on public.interview_toplines (org_id, updated_at desc);

alter table public.interview_toplines enable row level security;

-- org 멤버는 select 가능(후속 UI 렌더). 쓰기는 서버(admin client)만 하므로
-- insert/update 정책은 member, delete 는 admin 으로 좁힌다.
drop policy if exists "it_select_member" on public.interview_toplines;
create policy "it_select_member" on public.interview_toplines
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "it_insert_member" on public.interview_toplines;
create policy "it_insert_member" on public.interview_toplines
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "it_update_member" on public.interview_toplines;
create policy "it_update_member" on public.interview_toplines
  for update using (public.has_org_role(org_id, 'member'));

drop policy if exists "it_delete_admin" on public.interview_toplines;
create policy "it_delete_admin" on public.interview_toplines
  for delete using (public.has_org_role(org_id, 'admin'));

-- updated_at auto-bump.
create or replace function public.interview_toplines_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists interview_toplines_updated_at on public.interview_toplines;
create trigger interview_toplines_updated_at
  before update on public.interview_toplines
  for each row execute function public.interview_toplines_set_updated_at();

-- Realtime — 후속 2-tab UI 가 status(generating → done|error) 전이를
-- postgres_changes 로 구독한다. publication 에 안 붙이면 채널이 조용히
-- 이벤트를 못 받는다 (PROJECT.md §7.8).
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'interview_toplines'
  ) then
    alter publication supabase_realtime add table public.interview_toplines;
  end if;
end $$;
