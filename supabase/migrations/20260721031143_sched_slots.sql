-- Recruiting-scheduling PR2 — interview slots.
--
--   sched_slots — one proposed/confirmed interview time for a candidate.
--
-- A super admin assigns each candidate one or more time slots. Times are stored
-- as timestamptz (UTC) and rendered in the admin's local timezone. `status`
-- moves proposed → confirmed (or cancelled); double-booking is a soft warning in
-- the UI, never a DB constraint (an admin may legitimately overlap while
-- proposing options). RLS mirrors sched_batches/sched_candidates: the hardcoded
-- super-admin email gets full access and the admin API additionally gates in
-- code (isSuperAdminEmail + service-role client). Participant read access is
-- PR4's scope — no participant policy is added here.

create table if not exists public.sched_slots (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.sched_candidates(id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  status       text not null default 'proposed'
                 check (status in ('proposed', 'confirmed', 'cancelled')),
  location     text,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists sched_slots_candidate_idx
  on public.sched_slots (candidate_id);
create index if not exists sched_slots_start_idx
  on public.sched_slots (start_at);

alter table public.sched_slots enable row level security;

-- Super admin (hardcoded email, matched against auth.users) gets full access.
-- Same shape as sched_candidates_super_admin_all; admin routes also gate in code.
drop policy if exists "sched_slots_super_admin_all" on public.sched_slots;
create policy "sched_slots_super_admin_all"
  on public.sched_slots
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );
