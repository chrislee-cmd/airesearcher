-- Project-centric dashboard, phase 1 — schema only.
--
-- Goal: every artifact/job table can be filtered/grouped by `project_id`.
-- Existing rows keep `project_id IS NULL` (means "unfiled") so this
-- migration is safe to apply before any UI changes ship.
--
-- Three things happen here:
--   1) Add `project_id` to existing org-scoped job tables
--      (transcript_jobs, desk_jobs).
--   2) Lift `recruiting_forms` from user-only to org-scoped + project-aware
--      (was a multi-tenancy gap).
--   3) Create three new DB-backed job tables for features that today live
--      only in localStorage: interviews, reports, scheduler. The product
--      code is not yet wired to read/write these — that's phase 2 PRs.

------------------------------------------------------------------------
-- 1) Add project_id to existing job tables
------------------------------------------------------------------------

alter table public.transcript_jobs
  add column if not exists project_id uuid
    references public.projects(id) on delete set null;
create index if not exists transcript_jobs_project_idx
  on public.transcript_jobs (project_id);

alter table public.desk_jobs
  add column if not exists project_id uuid
    references public.projects(id) on delete set null;
create index if not exists desk_jobs_project_idx
  on public.desk_jobs (project_id);

------------------------------------------------------------------------
-- 2) recruiting_forms — promote to org-scoped + project-aware
--
-- Was keyed on user_id alone, which broke org-level isolation. Both new
-- columns are nullable for backwards compat: existing rows continue to
-- work via the user_id select policy, new inserts populate org_id from
-- the active org context. Tightening to NOT NULL is a follow-up once
-- the API route backfills.
------------------------------------------------------------------------

alter table public.recruiting_forms
  add column if not exists org_id uuid
    references public.organizations(id) on delete cascade,
  add column if not exists project_id uuid
    references public.projects(id) on delete set null;

create index if not exists recruiting_forms_org_idx
  on public.recruiting_forms (org_id, created_at desc);
create index if not exists recruiting_forms_project_idx
  on public.recruiting_forms (project_id);

-- Allow org members (not just the original publisher) to see forms once
-- they are tagged with an org. The user_id-only policy stays in place
-- for legacy rows where org_id IS NULL.
drop policy if exists recruiting_forms_org_select on public.recruiting_forms;
create policy recruiting_forms_org_select
  on public.recruiting_forms for select
  using (org_id is not null and public.has_org_role(org_id, 'viewer'));

------------------------------------------------------------------------
-- 3) New DB-backed job tables for features currently in localStorage
--
-- Common shape (mirrors desk_jobs / transcript_jobs):
--   id / org_id / project_id (nullable) / user_id / status / progress /
--   error_message / credits_spent / created_at / updated_at +
--   per-feature inputs and result columns.
-- RLS is the standard "viewer reads, member writes own, admin can clean
-- up" matrix used by the other job tables.
------------------------------------------------------------------------

-- interview_jobs ─────────────────────────────────────────────────────
create table if not exists public.interview_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- inputs: list of source files (filename / size / mime / storage_key)
  -- the client uploaded for this analysis run
  inputs jsonb not null default '[]'::jsonb,

  status text not null default 'queued'
    check (status in ('queued','converting','analyzing','done','error')),
  progress jsonb not null default '{}'::jsonb,

  -- outputs
  extractions jsonb,        -- per-file extracted items
  matrix jsonb,             -- aggregated result matrix
  thinking_log jsonb,       -- streamed reasoning trace (optional)
  error_message text,
  credits_spent int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists interview_jobs_org_idx
  on public.interview_jobs (org_id, created_at desc);
create index if not exists interview_jobs_user_idx
  on public.interview_jobs (user_id, created_at desc);
create index if not exists interview_jobs_project_idx
  on public.interview_jobs (project_id);
create index if not exists interview_jobs_status_idx
  on public.interview_jobs (status);

create or replace function public.touch_interview_jobs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_interview_jobs on public.interview_jobs;
create trigger trg_touch_interview_jobs
  before update on public.interview_jobs
  for each row execute function public.touch_interview_jobs();

alter table public.interview_jobs enable row level security;

create policy "ij_select_member" on public.interview_jobs
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "ij_insert_member" on public.interview_jobs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "ij_update_owner_or_admin" on public.interview_jobs
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "ij_delete_owner_or_admin" on public.interview_jobs
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

alter publication supabase_realtime add table public.interview_jobs;

-- report_jobs ────────────────────────────────────────────────────────
create table if not exists public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- inputs: list of source file names + sizes (uploads are not stored
  -- long-term; we keep names so the report header can credit sources)
  inputs jsonb not null default '[]'::jsonb,

  status text not null default 'queued'
    check (status in ('queued','normalizing','generating','done','error')),
  progress jsonb not null default '{}'::jsonb,

  -- outputs: canonical markdown then design-system HTML
  markdown text,
  html text,
  error_message text,
  credits_spent int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_jobs_org_idx
  on public.report_jobs (org_id, created_at desc);
create index if not exists report_jobs_user_idx
  on public.report_jobs (user_id, created_at desc);
create index if not exists report_jobs_project_idx
  on public.report_jobs (project_id);
create index if not exists report_jobs_status_idx
  on public.report_jobs (status);

create or replace function public.touch_report_jobs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_report_jobs on public.report_jobs;
create trigger trg_touch_report_jobs
  before update on public.report_jobs
  for each row execute function public.touch_report_jobs();

alter table public.report_jobs enable row level security;

create policy "rj_select_member" on public.report_jobs
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "rj_insert_member" on public.report_jobs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "rj_update_owner_or_admin" on public.report_jobs
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "rj_delete_owner_or_admin" on public.report_jobs
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

alter publication supabase_realtime add table public.report_jobs;

-- scheduler_sessions ─────────────────────────────────────────────────
-- Scheduler is not a pipeline (no async stages) — it's just a saved
-- canvas of attendees + selected time slots. We only need persistence
-- so the user gets the same view across devices/refreshes.
create table if not exists public.scheduler_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null default '',
  attendees jsonb not null default '[]'::jsonb,
  selected_slots jsonb not null default '[]'::jsonb,
  -- arbitrary extra config so future fields don't need a migration
  meta jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduler_sessions_org_idx
  on public.scheduler_sessions (org_id, created_at desc);
create index if not exists scheduler_sessions_user_idx
  on public.scheduler_sessions (user_id, created_at desc);
create index if not exists scheduler_sessions_project_idx
  on public.scheduler_sessions (project_id);

create or replace function public.touch_scheduler_sessions()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_scheduler_sessions on public.scheduler_sessions;
create trigger trg_touch_scheduler_sessions
  before update on public.scheduler_sessions
  for each row execute function public.touch_scheduler_sessions();

alter table public.scheduler_sessions enable row level security;

create policy "ss_select_member" on public.scheduler_sessions
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "ss_insert_member" on public.scheduler_sessions
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "ss_update_owner_or_admin" on public.scheduler_sessions
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "ss_delete_owner_or_admin" on public.scheduler_sessions
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

alter publication supabase_realtime add table public.scheduler_sessions;
