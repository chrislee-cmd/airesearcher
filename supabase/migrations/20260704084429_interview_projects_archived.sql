-- Interview V2 — 프로젝트 보관(soft delete) + 삭제 cascade.
--
-- 사용자 결정 (2026-07-04):
--   1. 보관 = soft delete: archived_at timestamp 로 리스트에서 숨김, 복구 가능.
--   2. 삭제 = hard delete + cascade: 프로젝트 + 관련 documents / chunks /
--      search queries 를 전부 제거, 복구 불가.
--
-- 이 마이그레이션이 하는 일:
--   (1) interview_projects.archived_at 컬럼 + 활성 프로젝트만 담는 partial index.
--   (2) 삭제 cascade 를 실제로 동작하게: interview_documents.project_id 와
--       interview_search_queries.project_id 의 FK 를 `on delete set null` →
--       `on delete cascade` 로 전환.
--         - 기존엔 프로젝트를 지우면 문서·질의는 project_id 만 null 로 남아
--           "보존" 됐다 (20260702... 스키마 주석). 사용자 결정 #2 는 완전 제거를
--           요구하므로 cascade 로 바꾼다.
--         - interview_chunks.document_id 는 이미 on delete cascade 라
--           (20260624123016_interview_corpus.sql), 문서가 지워지면 청크는 자동으로
--           따라 지워진다 — 별도 처리 불필요.
--         - project_id 가 null 인 legacy / cross-project 문서·질의는 부모가 없어
--           영향 없음.

-- (1) archived_at ------------------------------------------------------------
alter table public.interview_projects
  add column if not exists archived_at timestamptz;

-- 활성(미보관) 프로젝트만 인덱싱하는 partial index — 리스트 기본 조회
-- (archived_at is null) 를 가볍게 유지.
create index if not exists interview_projects_archived_idx
  on public.interview_projects (archived_at)
  where archived_at is null;

-- (2) 삭제 cascade -----------------------------------------------------------
alter table public.interview_documents
  drop constraint if exists interview_documents_project_id_fkey;
alter table public.interview_documents
  add constraint interview_documents_project_id_fkey
  foreign key (project_id)
  references public.interview_projects(id)
  on delete cascade;

alter table public.interview_search_queries
  drop constraint if exists interview_search_queries_project_id_fkey;
alter table public.interview_search_queries
  add constraint interview_search_queries_project_id_fkey
  foreign key (project_id)
  references public.interview_projects(id)
  on delete cascade;
