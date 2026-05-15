-- Report Enhance: version tree.
-- Each report_jobs row keeps the latest pointer (markdown/html). Every
-- generation (v0 = original) and every subsequent enhancement (trends /
-- logs / perspective) is materialized as a row here so users can compare,
-- revert, or branch a new enhancement from any previous version.

create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.report_jobs(id) on delete cascade,

  -- 0 = original generated report. 1, 2, ... = sequential enhancements.
  version int not null,
  -- Which version this one was enhanced from. null for v0.
  parent_version int,

  -- null for v0. one of 'trends' | 'logs' | 'perspective' for enhancements.
  enhancement text
    check (enhancement is null or enhancement in ('trends','logs','perspective')),

  -- Canonical markdown is the SSOT. HTML is always re-rendered from it.
  markdown text not null,
  html text not null,

  -- Snapshot of the external context the user supplied for this enhancement.
  -- Shape: { mode, inputs: [...], user_note? } — see src/lib/reports/context-payload.ts
  context_payload jsonb,

  credits_spent int not null default 0,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  unique (report_id, version)
);

create index if not exists report_versions_report_idx
  on public.report_versions (report_id, version desc);

alter table public.report_versions enable row level security;

-- Policies mirror report_jobs: org viewers can read, members can insert
-- their own row, owners/admins can update or delete.
create policy "rv_select_member" on public.report_versions
  for select using (
    exists (
      select 1 from public.report_jobs rj
      where rj.id = report_versions.report_id
        and public.has_org_role(rj.org_id, 'viewer')
    )
  );

create policy "rv_insert_member" on public.report_versions
  for insert with check (
    created_by = auth.uid() and exists (
      select 1 from public.report_jobs rj
      where rj.id = report_versions.report_id
        and public.has_org_role(rj.org_id, 'member')
    )
  );

create policy "rv_update_owner_or_admin" on public.report_versions
  for update using (
    created_by = auth.uid() or exists (
      select 1 from public.report_jobs rj
      where rj.id = report_versions.report_id
        and public.has_org_role(rj.org_id, 'admin')
    )
  );

create policy "rv_delete_owner_or_admin" on public.report_versions
  for delete using (
    created_by = auth.uid() or exists (
      select 1 from public.report_jobs rj
      where rj.id = report_versions.report_id
        and public.has_org_role(rj.org_id, 'admin')
    )
  );

-- "Head" pointer on report_jobs — which version is currently shown when
-- the user opens this report. Defaults to the highest version. Letting it
-- be explicit lets users revert to an earlier version without deleting
-- the later ones.
alter table public.report_jobs
  add column if not exists head_version int;

-- Realtime so version inserts can stream to a future Versions sidebar if
-- needed; harmless to enable now.
alter publication supabase_realtime add table public.report_versions;
