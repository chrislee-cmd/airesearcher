-- Recruiting-scheduling stack base (PR1). Two tables underpin the whole epic:
--
--   sched_batches      — one "upload set" of candidates a super admin manages.
--   sched_candidates   — one interview candidate, unique per (batch, email).
--
-- CSV/XLSX bulk upload merges by email (unique(batch_id,email)), preserving any
-- unmapped source columns in `fields` jsonb. `participant_token` is minted here
-- but NOT surfaced in the PR1 list — PR4 uses it for the public participant
-- link. RLS mirrors recruiting_invitations: a hardcoded super-admin email gets
-- full access; the admin API additionally gates in code via isSuperAdminEmail
-- and uses the service-role client (defense in depth).

create table if not exists public.sched_batches (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  created_at    timestamptz not null default now()
);

create index if not exists sched_batches_owner_idx
  on public.sched_batches (owner_user_id);
create index if not exists sched_batches_created_idx
  on public.sched_batches (created_at desc);

create table if not exists public.sched_candidates (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.sched_batches(id) on delete cascade,
  email             text not null,
  name              text,
  phone             text,
  fields            jsonb not null default '{}'::jsonb,
  -- Minted at upsert time; consumed by PR4's public participant link. Never
  -- rendered in the PR1 candidate list.
  participant_token text not null default gen_random_uuid()::text,
  created_at        timestamptz not null default now(),
  unique (batch_id, email)
);

create index if not exists sched_candidates_batch_idx
  on public.sched_candidates (batch_id);
create unique index if not exists sched_candidates_token_idx
  on public.sched_candidates (participant_token);

alter table public.sched_batches enable row level security;
alter table public.sched_candidates enable row level security;

-- Super admin (hardcoded email, matched against auth.users) gets full access.
-- Same shape as recruiting_invitations' invitations_super_admin_all policy —
-- the admin routes also gate in code (isSuperAdminEmail + service-role client).
drop policy if exists "sched_batches_super_admin_all" on public.sched_batches;
create policy "sched_batches_super_admin_all"
  on public.sched_batches
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );

drop policy if exists "sched_candidates_super_admin_all" on public.sched_candidates;
create policy "sched_candidates_super_admin_all"
  on public.sched_candidates
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );
