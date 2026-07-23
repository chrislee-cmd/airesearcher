-- Re-point transcript_jobs.project_id at the Interview V2 project table.
--
-- transcript_jobs.project_id was created in 0014_project_scoping.sql with
-- `references public.projects(id)` — the legacy workspace "active project"
-- table. But the transcript widget's project selection is fed by the Interview
-- V2 store (public.interview_projects, added in 20260702074657): the quotes /
-- transcript card sends an interview_projects id in the create/start payload
-- (quotes-card-body.tsx: `project_id: projectIdRef.current`, sourced from
-- useInterviewV2Projects()). With the FK still pointing at public.projects,
-- inserting that id raised 23503 "Key (project_id)=(…) is not present in table
-- projects", surfacing as a crash on transcript create/start — the same latent
-- crash class as desk_jobs (20260723135946) and interview_documents
-- (20260702144738). Card 544 hotfix null-demoted the id to stop the crash, at
-- the cost of project attribution; this migration restores attribution by
-- reconciling the FK target with the selection SSOT.
--
-- User decision: interview_projects is the project SSOT. Re-point the FK to
-- match. Safe: any existing transcript_jobs.project_id that is NOT a valid
-- interview_projects id (e.g. a legacy public.projects fallback value, or a
-- 544-era value) is first demoted to NULL ("unfiled") so the new constraint
-- validates. Job rows are preserved — only the project attribution is reset.
-- The create/start routes (project-guard.ts) and /api/artifacts/assign
-- additionally validate project_id against interview_projects and null-demote /
-- reject anything else, so no writer can mirror-crash against the new FK.

-- 1) Null out orphans so the new FK can be added without violation.
--    Idempotent: re-running only nulls rows that are still not in interview_projects.
update public.transcript_jobs tj
   set project_id = null
 where tj.project_id is not null
   and not exists (
     select 1 from public.interview_projects ip where ip.id = tj.project_id
   );

-- 2) Swap the FK target public.projects -> public.interview_projects.
--    Index transcript_jobs_project_idx (0014) is unaffected and preserved.
alter table public.transcript_jobs
  drop constraint if exists transcript_jobs_project_id_fkey;

alter table public.transcript_jobs
  add constraint transcript_jobs_project_id_fkey
  foreign key (project_id)
  references public.interview_projects(id)
  on delete set null;
