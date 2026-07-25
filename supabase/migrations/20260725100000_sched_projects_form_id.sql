-- journey P0 bridge — link a scheduling project to the recruiting form it was
-- provisioned from (form↔project 1:1, decision D5).
--
-- The recruiting fullview is form-anchored; opening it (or its 명단 tab)
-- resolve-or-creates exactly one sched_projects row per form_id. `form_id` is a
-- TEXT reference to recruiting_forms.form_id (a text PK) — deliberately a SOFT
-- reference (no FK): a project may be provisioned before/without the form row
-- being present in every environment, and we never want a missing form to block
-- project creation. Manual (non-bridge) projects keep form_id NULL and coexist.
--
-- Additive + idempotent (add column + indexes only) so the merge-to-main
-- auto-apply gate ships it without manual review.

alter table public.sched_projects
  add column if not exists form_id text;

create index if not exists sched_projects_form_idx
  on public.sched_projects (form_id);

-- 1:1 lazy provisioning guard: at most one project per form_id (only when set,
-- so the many manual form_id-NULL projects are unaffected). The resolve-or-create
-- helper re-selects on a unique violation, keeping concurrent opens race-safe.
create unique index if not exists sched_projects_form_uq
  on public.sched_projects (form_id)
  where form_id is not null;
