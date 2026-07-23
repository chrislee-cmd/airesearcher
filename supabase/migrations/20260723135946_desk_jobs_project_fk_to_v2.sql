-- Re-point desk_jobs.project_id at the Interview V2 project table.
--
-- desk_jobs.project_id was created in 0014_project_scoping.sql with
-- `references public.projects(id)` — the legacy workspace "active project"
-- table. But the desk widget's STEP1 ProjectPicker is fed by the shared
-- ProjectSelectionProvider, whose project list is the Interview V2 store
-- (public.interview_projects, added in 20260702074657). So when the user
-- picks a project in the desk card, the client sends an interview_projects
-- id (desk-card-body.tsx: `project_id: getSelection('desk') ?? readActiveProjectId()`).
-- With the FK still pointing at public.projects, inserting that id raised
-- 23503 "Key (project_id)=(…) is not present in table projects", surfacing
-- as a 500 from /api/desk — the same latent crash class as transcript_jobs
-- (cards 544/545) and interview_documents (20260702144738).
--
-- User decision (2026-07-10): interview_projects is the project SSOT. Re-point
-- the FK to match. Safe: any existing desk_jobs.project_id that is NOT a valid
-- interview_projects id (e.g. a legacy readActiveProjectId / public.projects
-- fallback value) is first demoted to NULL ("unfiled") so the new constraint
-- validates. Job rows are preserved — only the project attribution is reset.
-- The /api/desk route additionally validates project_id against
-- interview_projects and null-demotes anything else, so the legacy fallback id
-- can never mirror-crash against the new FK.

-- 1) Null out orphans so the new FK can be added without violation.
--    Idempotent: re-running only nulls rows that are still not in interview_projects.
update public.desk_jobs dj
   set project_id = null
 where dj.project_id is not null
   and not exists (
     select 1 from public.interview_projects ip where ip.id = dj.project_id
   );

-- 2) Swap the FK target public.projects -> public.interview_projects.
alter table public.desk_jobs
  drop constraint if exists desk_jobs_project_id_fkey;

alter table public.desk_jobs
  add constraint desk_jobs_project_id_fkey
  foreign key (project_id)
  references public.interview_projects(id)
  on delete set null;
