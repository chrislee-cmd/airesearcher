-- Interview V2 — 프로젝트 태그(자유 라벨) 부착 + 태그별 필터.
--
-- 사용자 결정 (2026-07-06):
--   1. 스키마 = interview_projects.tags text[] (별도 태그 테이블 X).
--      org 규모에서 배열이 단순·충분. 태그 rename/통계가 필요해지면 그때
--      정규화한다.
--   2. 필터 쿼리(태그 교집합)를 위해 GIN 인덱스를 건다.
--
-- 부착/필터는 프로젝트 목록 UI 안에서만 동작하고, 태그 저장은 기존
-- v2/projects PATCH 로 통째 교체한다 (부분 연산 불요).

alter table public.interview_projects
  add column if not exists tags text[] not null default '{}';

-- 태그 교집합(OR/AND) 조회용 GIN 인덱스 — `tags && array[...]` / `tags @> ...`.
create index if not exists interview_projects_tags_gin_idx
  on public.interview_projects using gin (tags);
