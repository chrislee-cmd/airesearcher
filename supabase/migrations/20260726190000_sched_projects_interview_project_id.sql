-- form-free intake (card 583) — anchor a scheduling project to the recruiting
-- (interview_projects) pill axis, not just to a Google form.
--
-- Until now sched_projects could only be provisioned from a form_id (migration
-- 20260725100000). A user who already has a participant list from another
-- channel had no way to intake it without first publishing a form. This adds a
-- SECOND anchor: interview_project_id, so opening the fused recruiting journey
-- for a pill project (with no form yet) resolve-or-creates one project, and a
-- later form publish + bridge CONVERGES on that same row (no roster split).
--
-- `interview_project_id` is a UUID reference to interview_projects.id —
-- deliberately a SOFT reference (no FK), mirroring form_id: a project may be
-- provisioned before the interview_projects row is guaranteed present in every
-- environment, and a missing pill row must never block scheduling provisioning.
-- form-anchored projects keep interview_project_id NULL and coexist; the resolve
-- helper stamps the missing axis when the two paths meet so they converge.
--
-- Additive + idempotent (add column + indexes only) so the merge-to-main
-- auto-apply gate ships it without manual review.

alter table public.sched_projects
  add column if not exists interview_project_id uuid;

create index if not exists sched_projects_interview_project_idx
  on public.sched_projects (interview_project_id);

-- 1:1 lazy provisioning guard: at most one project per interview_project_id
-- (only when set, so form-anchored / manual interview_project_id-NULL projects
-- are unaffected). The resolve-or-create helper re-selects on a unique violation,
-- keeping concurrent opens race-safe — the same 23505 pattern as form_id.
create unique index if not exists sched_projects_interview_project_uq
  on public.sched_projects (interview_project_id)
  where interview_project_id is not null;
