-- Re-point interview_documents.project_id at the Interview V2 project table.
--
-- interview_documents.project_id was created in 20260624123016_interview_corpus.sql
-- with `references public.projects(id)` — the legacy workspace "active project"
-- table. That migration predates the Interview V2 project store
-- (public.interview_projects, added in 20260702074657_interview_v2_projects_and_queries.sql).
--
-- V2 groups uploaded interview files under interview_projects, and the upload
-- flow scopes each interview_documents row to the current V2 project via
-- project_id (the /projects/[id]/documents list filters on it). With the FK
-- still pointing at public.projects, inserting a V2 project id raised
-- 23503 "Key (project_id)=(…) is not present in table projects", surfacing as
-- a 500 from /api/interviews/index (and /convert when it also carried the id).
--
-- Re-point the FK to interview_projects. Safe: interview_documents.project_id
-- has only ever been NULL in prod (this upload wiring is its first writer), so
-- no existing row can violate the new constraint.

alter table public.interview_documents
  drop constraint if exists interview_documents_project_id_fkey;

alter table public.interview_documents
  add constraint interview_documents_project_id_fkey
  foreign key (project_id)
  references public.interview_projects(id)
  on delete set null;
