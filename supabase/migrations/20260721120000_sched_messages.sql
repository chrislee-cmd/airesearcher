-- Recruiting-scheduling PR3 — chat / comments.
--
--   sched_messages — one chat message in the scheduling coordination thread.
--
-- Two modes, disambiguated by `candidate_id`:
--   * broadcast (candidate_id IS NULL)  — announcement visible to every
--     participant. scope = 'broadcast'.
--   * private   (candidate_id IS NOT NULL) — a 1:1 thread with one candidate.
--     scope = 'private'.
-- The scope↔candidate_id invariant is enforced by a CHECK so a broadcast can
-- never carry a candidate_id and a private message can never omit one — PR4's
-- participant-side exposure keys off exactly this split, so it must hold at the
-- DB level, not just in the API.
--
-- `sender_role` is admin|participant. This PR only ever inserts admin rows
-- (participant send is PR4); the enum is defined now so PR4 needs no migration.
-- `sender_user_id` is the auth.users id for admin senders (NULL for anonymous
-- participants in PR4). RLS mirrors sched_slots/sched_candidates: the hardcoded
-- super-admin email gets full access and the admin API additionally gates in
-- code (isSuperAdminEmail + service-role client). Participant read/write is
-- PR4's scope — no participant policy is added here.

create table if not exists public.sched_messages (
  id             uuid primary key default gen_random_uuid(),
  -- NULL = broadcast (all participants); set = private thread with one candidate.
  candidate_id   uuid references public.sched_candidates(id) on delete cascade,
  scope          text not null check (scope in ('broadcast', 'private')),
  sender_role    text not null check (sender_role in ('admin', 'participant')),
  -- auth.users id for admin senders; NULL for anonymous participant sends (PR4).
  sender_user_id uuid references auth.users(id) on delete set null,
  body           text not null,
  created_at     timestamptz not null default now(),
  -- scope↔candidate_id invariant: broadcast has no candidate, private has one.
  constraint sched_messages_scope_candidate_ck check (
    (scope = 'broadcast' and candidate_id is null) or
    (scope = 'private' and candidate_id is not null)
  )
);

create index if not exists sched_messages_candidate_idx
  on public.sched_messages (candidate_id);
create index if not exists sched_messages_created_idx
  on public.sched_messages (created_at);
create index if not exists sched_messages_scope_idx
  on public.sched_messages (scope);

alter table public.sched_messages enable row level security;

-- Super admin (hardcoded email, matched against auth.users) gets full access.
-- Same shape as sched_slots_super_admin_all; admin routes also gate in code.
drop policy if exists "sched_messages_super_admin_all" on public.sched_messages;
create policy "sched_messages_super_admin_all"
  on public.sched_messages
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );

-- Wire sched_messages into the Realtime publication so the admin chat panel's
-- `postgres_changes` subscription actually receives INSERT events. Without this
-- the table is queryable but the Realtime broker drops every event silently
-- (PROJECT.md §7.8). Guarded so re-running on an already-added table is a no-op.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'sched_messages'
  ) then
    alter publication supabase_realtime add table public.sched_messages;
  end if;
end $$;
