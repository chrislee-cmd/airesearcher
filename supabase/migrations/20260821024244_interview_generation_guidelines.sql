-- 인터뷰 탑라인 — 프로젝트 단위 "분석 가이드라인" 아티팩트 + 캐시 키 컬럼.
--
-- 배경: 예전 "자체 보고서 업로드"(source='uploaded')는 완성 보고서를 md→blocks
-- 로 파싱해 그대로 표시하던 **생성 우회** 경로였다. 이제 업로드 파일을 결과물이
-- 아니라 **생성이 따라야 할 가이드 문서**로 재정의한다 — 가이드가 있으면 map-reduce
-- 생성물이 그 기준(섹션 구성·분석 관점·집계 방식·용어·톤)에 충실하게 만들어진다.
--
-- user_direction(600자, 재생성 1회성)과 분리한다: 가이드라인은 **프로젝트에 지속**
-- (재생성/언어변경에도 유지, 명시 교체·삭제 전까지)한다. 그래서 interview_toplines
-- 컬럼이 아니라 프로젝트당 1건인 전용 테이블로 둔다(row 생성 여부와 무관하게 존속).
--
-- RLS 는 org 스코프(has_org_role) — interview_toplines 와 동일 컨벤션. 쓰기는
-- 서버(admin client)가 소유 검증 후 수행하지만, 일반 client select 를 위해 viewer
-- 정책을 둔다.

create table if not exists public.interview_generation_guidelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.interview_projects(id) on delete cascade,
  -- 가이드 문서 전문(Markdown). 대용량 허용(수 KB) — 업로드 시 문자수 상한만
  -- 서버가 검증(topline-guideline.ts GUIDELINE_MAX_CHARS). 프롬프트 주입 시엔
  -- 별도 토큰 예산(GUIDELINE_PROMPT_MAX_CHARS)으로 절단한다.
  guideline_md text not null,
  -- 가이드 문서 해시 = 캐시 무효화 키. interview_toplines.guideline_hash 와 비교해
  -- 다르면 stale(재생성 필요). corpus_hash 에는 넣지 않는다 — 가이드는 코퍼스가
  -- 아니라 생성 지시라 dedup·stale 판정에만 쓴다.
  guideline_hash text not null,
  -- 원본 파일명 — 카드 배지("분석 가이드라인: <filename>") 표시용.
  filename text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 프로젝트당 가이드 1건 — 업로드는 upsert(overwrite). unique 로 조회를
-- (project_id) 단일 키로 단순화.
create unique index if not exists interview_generation_guidelines_project_uq
  on public.interview_generation_guidelines (project_id);

create index if not exists interview_generation_guidelines_org_idx
  on public.interview_generation_guidelines (org_id, updated_at desc);

alter table public.interview_generation_guidelines enable row level security;

-- org 멤버는 select 가능(카드 배지 렌더). 쓰기는 서버(admin client)만 하므로
-- insert/update 정책은 member, delete 는 member 로 좁힌다(interview_toplines 미러).
drop policy if exists "igg_select_member" on public.interview_generation_guidelines;
create policy "igg_select_member" on public.interview_generation_guidelines
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "igg_insert_member" on public.interview_generation_guidelines;
create policy "igg_insert_member" on public.interview_generation_guidelines
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "igg_update_member" on public.interview_generation_guidelines;
create policy "igg_update_member" on public.interview_generation_guidelines
  for update using (public.has_org_role(org_id, 'member'));

drop policy if exists "igg_delete_member" on public.interview_generation_guidelines;
create policy "igg_delete_member" on public.interview_generation_guidelines
  for delete using (public.has_org_role(org_id, 'member'));

-- updated_at auto-bump.
create or replace function public.interview_generation_guidelines_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists interview_generation_guidelines_updated_at
  on public.interview_generation_guidelines;
create trigger interview_generation_guidelines_updated_at
  before update on public.interview_generation_guidelines
  for each row execute function public.interview_generation_guidelines_set_updated_at();

-- interview_toplines 에 가이드 캐시 키 컬럼 추가 — 이 보고서가 생성될 때 유효했던
-- 가이드의 해시. dedup(route POST)이 현재 가이드 해시와 비교해 다르면 재생성한다.
-- NULL = 가이드 없이 생성됨/레거시. additive(nullable) — apply-migrations 자동 적용.
alter table public.interview_toplines
  add column if not exists guideline_hash text;

comment on column public.interview_toplines.guideline_hash is
  '이 탑라인 생성 시 유효했던 분석 가이드라인의 해시. NULL = 가이드 없이 생성/레거시. 현재 가이드 해시와 다르면 stale(재생성 필요).';
