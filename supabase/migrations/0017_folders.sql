-- Folder hierarchy inside a project.
--
-- A folder is org-scoped, belongs to exactly one project, and can nest
-- under another folder in the same project. Artifacts opt into a folder
-- by setting `folder_id` on their source table (transcript_jobs,
-- desk_jobs, interview_jobs, report_jobs, scheduler_sessions,
-- recruiting_forms, generations). NULL folder_id means "project root".
--
-- Deletes cascade folder→folder via ON DELETE CASCADE on parent_folder_id
-- (deleting a folder also deletes its subfolders). Artifact rows use
-- ON DELETE SET NULL so they fall back to the project root instead of
-- vanishing.

------------------------------------------------------------------------
-- 1) folders table
------------------------------------------------------------------------

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_folder_id uuid references public.folders(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_project_idx
  on public.folders (project_id, created_at desc);
create index if not exists folders_org_idx
  on public.folders (org_id);
create index if not exists folders_parent_idx
  on public.folders (parent_folder_id);

create or replace function public.touch_folders()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_folders on public.folders;
create trigger trg_touch_folders
  before update on public.folders
  for each row execute function public.touch_folders();

alter table public.folders enable row level security;

create policy "folders_select_member" on public.folders
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "folders_insert_member" on public.folders
  for insert with check (
    public.has_org_role(org_id, 'member') and created_by = auth.uid()
  );
create policy "folders_update_member" on public.folders
  for update using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "folders_delete_member" on public.folders
  for delete using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

------------------------------------------------------------------------
-- 2) folder_id columns on artifact-bearing tables
--
-- All nullable. Existing rows stay at folder_id IS NULL ("project root").
-- ON DELETE SET NULL so deleting a folder lifts its contents back to the
-- project root instead of orphaning rows.
------------------------------------------------------------------------

alter table public.transcript_jobs
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists transcript_jobs_folder_idx
  on public.transcript_jobs (folder_id);

alter table public.desk_jobs
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists desk_jobs_folder_idx
  on public.desk_jobs (folder_id);

alter table public.interview_jobs
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists interview_jobs_folder_idx
  on public.interview_jobs (folder_id);

alter table public.report_jobs
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists report_jobs_folder_idx
  on public.report_jobs (folder_id);

alter table public.scheduler_sessions
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists scheduler_sessions_folder_idx
  on public.scheduler_sessions (folder_id);

alter table public.recruiting_forms
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists recruiting_forms_folder_idx
  on public.recruiting_forms (folder_id);

alter table public.generations
  add column if not exists folder_id uuid
    references public.folders(id) on delete set null;
create index if not exists generations_folder_idx
  on public.generations (folder_id);
