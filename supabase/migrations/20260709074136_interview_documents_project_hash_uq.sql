-- Interview V2 — project-scoped upload dedupe.
--
-- Problem: the existing dedupe (interview_documents_job_hash_uq on
-- (interview_job_id, content_hash)) is only *batch*-scoped. Every upload batch
-- creates a fresh interview_job (use-interview-v2-upload.ts), so re-uploading
-- the same file in a later batch lands under a different interview_job_id and
-- never trips the job-scoped conflict → duplicate document rows accumulate in
-- the project (same content_hash, different job). That inflates search
-- evidence, duplicates quotes, and wastes embedding cost.
--
-- Fix: dedupe at the *project* level. content_hash is the hash of the
-- normalized markdown, so the same source file always hashes identically
-- regardless of which batch/job it arrived in — a true content match even when
-- the filename differs.
--
-- Two steps:
--   1. Collapse the duplicates that already accumulated. Keep the earliest
--      document per (project_id, content_hash); delete the rest. Deleting a
--      duplicate cascades to its interview_chunks (document_id → on delete
--      cascade), so the stale embeddings go too — exactly the cleanup the
--      feature is meant to deliver.
--   2. A unique index on (project_id, content_hash). This is what lets the
--      index route do an atomic, race-safe `insert ... on conflict do nothing`
--      at project scope.
--
-- Why a plain (non-partial) unique index rather than a partial one
-- (`where project_id is not null`): PostgREST's on_conflict only takes column
-- names — it can't carry a partial index's WHERE predicate — so a partial index
-- is not inferable as an ON CONFLICT arbiter (error 42P10). A non-partial index
-- is functionally equivalent for dedupe here: Postgres treats NULLs as distinct,
-- so legacy (project-less) uploads with project_id = NULL never conflict and
-- multiple NULL-project rows stay allowed — exactly what the partial predicate
-- would have granted, but usable as the atomic on-conflict target the route
-- needs.
--
-- The old job-scoped uq is intentionally kept — it is harmless (a stricter
-- subset guarantee within a single job) and dropping it is out of scope.

-- 1. Collapse existing project-scoped duplicates, keeping the earliest row.
delete from public.interview_documents d
using public.interview_documents keep
where d.project_id is not null
  and d.project_id = keep.project_id
  and d.content_hash = keep.content_hash
  and (
    keep.created_at < d.created_at
    or (keep.created_at = d.created_at and keep.id < d.id)
  );

-- 2. Project-scoped unique index — the dedupe guarantee + on-conflict arbiter.
create unique index if not exists interview_documents_project_hash_uq
  on public.interview_documents (project_id, content_hash);
