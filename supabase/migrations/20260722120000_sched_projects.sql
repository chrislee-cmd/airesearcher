-- Recruiting-scheduling PR-C — projects as a new top layer above batches.
--
-- The hierarchy used to be sched_batches (=group) → sched_candidates. Users
-- asked for a project layer that bundles several uploads (each upload = one
-- group=batch) under one selectable unit, with an "all list" vs "grouped" view:
--
--   sched_projects → sched_batches (=group) → sched_candidates
--
-- All changes are additive (no drop/rename/type change, project_id stays
-- nullable) so the merge-to-main auto-apply handles them. RLS mirrors
-- sched_batches: a hardcoded super-admin email gets full access; the admin API
-- also gates in code (isSuperAdminEmail + service-role client).

create table if not exists public.sched_projects (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  created_at    timestamptz not null default now()
);

create index if not exists sched_projects_owner_idx
  on public.sched_projects (owner_user_id);
create index if not exists sched_projects_created_idx
  on public.sched_projects (created_at desc);

alter table public.sched_projects enable row level security;

-- Same shape as sched_batches_super_admin_all — super admin (hardcoded email,
-- matched against auth.users) gets full access; the admin routes also gate in
-- code (isSuperAdminEmail + service-role client).
drop policy if exists "sched_projects_super_admin_all" on public.sched_projects;
create policy "sched_projects_super_admin_all"
  on public.sched_projects
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );

-- Batches now belong to a project. Nullable + on delete cascade — additive so a
-- preview DB without this column simply falls back to the batch-only view.
alter table public.sched_batches
  add column if not exists project_id uuid
    references public.sched_projects(id) on delete cascade;

create index if not exists sched_batches_project_idx
  on public.sched_batches (project_id);

-- Backfill: one project per existing batch (1:1), preserving title/owner so the
-- unit that used to be selectable is kept as its own project (non-destructive).
-- Correlate deterministically by inserting per-row inside a loop rather than a
-- set-based INSERT ... RETURNING (title/owner/created_at could collide).
do $$
declare
  b record;
  new_pid uuid;
begin
  for b in
    select id, owner_user_id, title, created_at
    from public.sched_batches
    where project_id is null
  loop
    insert into public.sched_projects (owner_user_id, title, created_at)
    values (b.owner_user_id, b.title, b.created_at)
    returning id into new_pid;

    update public.sched_batches set project_id = new_pid where id = b.id;
  end loop;
end $$;
