-- Projects: organize generations into folders within an org.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index on public.projects (org_id, created_at desc);

alter table public.projects enable row level security;

create policy "projects_select_member" on public.projects
  for select using (public.has_org_role(org_id, 'viewer'));

create policy "projects_insert_member" on public.projects
  for insert with check (
    public.has_org_role(org_id, 'member') and created_by = auth.uid()
  );

create policy "projects_update_member_own_or_admin" on public.projects
  for update using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

create policy "projects_delete_admin_or_creator" on public.projects
  for delete using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- Tag generations with a project (nullable for backwards compat)
alter table public.generations
  add column project_id uuid references public.projects(id) on delete set null;
create index on public.generations (project_id);
