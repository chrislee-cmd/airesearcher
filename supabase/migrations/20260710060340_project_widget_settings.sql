-- 통합 프로젝트 기반 — 위젯별 프로젝트 설정 저장소 (project_widget_settings).
--
-- 배경 (사용자 결정 2026-07-10): 프로빙/통역에 인터뷰 결과 생성기의 "프로젝트
-- 설정 드롭다운" 을 붙여 프로젝트별 설정(프로빙 페르소나 섹션 구성 / 통역 용어집)
-- 이 달라지게 한다. 설정은 DB 영속.
--
-- 프로젝트 엔티티(목록)는 이미 존재하는 interview_projects 를 SSOT 로 재사용한다
-- (리네임하면 interview_documents / interview_search_queries 의 FK repoint 부담이
-- 커서 비파괴로 그대로 쓴다 — 20260702074657 참고). 이 마이그는 그 위에 위젯별
-- 설정 한 겹만 얹는다.
--
--   project_widget_settings(project_id, widget_key) unique — 프로젝트 × 위젯 당
--   설정 jsonb 한 row. widget_key = 'probing' | 'translate' | 'interview' | ...
--   (확장 가능, 서버가 slug 형태만 검증). settings 는 위젯별 자유 스키마:
--     프로빙 → { customSections, hiddenKeys }
--     통역   → { glossary }
--
-- 소비처: 인터뷰(기존) · 프로빙(#542) · 통역(#543). 데스크/전사록 등은 대상 아님.

create table if not exists public.project_widget_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.interview_projects(id) on delete cascade,
  widget_key text not null,             -- 'probing' | 'translate' | 'interview' | ...
  settings jsonb not null default '{}', -- 위젯별 설정 (자유 스키마)
  updated_at timestamptz not null default now(),
  unique (project_id, widget_key)
);

-- 조회는 항상 (project_id, widget_key) 로 point-lookup — unique 제약이 이미
-- 인덱스를 만들어주므로 별도 인덱스 불필요.

alter table public.project_widget_settings enable row level security;

-- RLS = 프로젝트 소유 경유. project_widget_settings 자체엔 user_id 컬럼을 두지
-- 않고(정규화 유지), 소유는 interview_projects 로 위임한다. subquery 안의
-- interview_projects 도 자기 "own project rw" RLS(user_id = auth.uid()) 를 그대로
-- 받으므로, 내가 소유한 프로젝트의 설정 row 만 select/insert/update/delete 가능.
-- (PROJECT.md §7.10 은 PostgREST embed 의 조용한 0-row 함정 — 여기선 embed 가
--  아니라 policy 내부 exists() 이므로 무관.)
drop policy if exists "own project widget settings rw"
  on public.project_widget_settings;
create policy "own project widget settings rw"
  on public.project_widget_settings
  for all
  using (
    exists (
      select 1 from public.interview_projects p
      where p.id = project_widget_settings.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.interview_projects p
      where p.id = project_widget_settings.project_id
        and p.user_id = auth.uid()
    )
  );

-- updated_at auto-bump — upsert(on conflict update) 시에도 최신 시각 유지.
create or replace function public.project_widget_settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_widget_settings_updated_at
  on public.project_widget_settings;
create trigger project_widget_settings_updated_at
  before update on public.project_widget_settings
  for each row execute function public.project_widget_settings_set_updated_at();
