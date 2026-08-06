-- sched_* RLS backstop (W1-D) — standard org-role policies on the 5-table stack.
--
-- Background (AUDIT-collab-storage-2026-08-06 §W1-D): 20260725100200_sched_org_id
-- added `org_id` to sched_projects/batches/candidates/slots/messages "additive
-- only" but laid down NO RLS policies. Each table has RLS *enabled* yet carries
-- only a `*_super_admin_all` policy (hardcoded email) — so for every non-super
-- -admin the sole tenancy wall is the API's `getSchedulingAccess()` code scope.
-- These tables hold candidate contact data (name/phone), so a code-scope-only
-- surface has no defense-in-depth. This migration adds the missing standard
-- org-role policies as a BACKSTOP (not a replacement): the code scope stays.
--
-- Model (mirrors has_org_role usage elsewhere in the schema):
--   * select  → has_org_role(org_id, 'viewer')  — any org member may read.
--   * ins/upd/del → has_org_role(org_id, 'member') — write = member+.
-- Equivalence-first: getSchedulingAccess opens scheduling to org members with
-- full access (no viewer/admin tier), so member-level writes are the code-scope
-- equivalent. No admin elevation — the code scope doesn't distinguish it.
--
-- org_id NULL rows: has_org_role(NULL, ...) is always false (its subquery filters
-- `m.org_id = p_org`, never true for NULL), so a NULL-org row is DENIED to every
-- org member by construction — reachable only via the service-role path (which
-- bypasses RLS) or the super-admin policy. Per spec, NULL rows are backfilled
-- where an owner->org chain exists (idempotent re-run of the 20260725100200
-- backfill below, NULL-only so it's a no-op on already-stamped rows); any
-- residual NULL (owner with no org membership) is intentionally left denied.
--
-- The pre-existing `*_super_admin_all` policies are untouched — Postgres ORs
-- permissive policies, so super-admins keep unrestricted access while org
-- members gain the scoped backstop. All statements are additive/idempotent
-- (enable RLS is a no-op when already on; policies are drop-if-exists guarded;
-- the backfill is a NULL-only UPDATE) so the merge-to-main auto-apply handles it.
--
-- Public responder flow (/schedule/<share_token>, phone-tail verify, response
-- submit) is 100% service-role (createAdminClient) — see src/lib/scheduling/
-- public.ts, which explicitly refuses any anon SELECT policy / RPC — so it is
-- unaffected by these member-scoped policies. The only browser-anon touch on
-- sched_* is the authed admin's realtime postgres_changes subscription on
-- sched_messages (use-sched-messages / use-sched-unread); today RLS delivers
-- those events to super-admins only (non-super-admins fall back to polling), so
-- adding the viewer SELECT policy only *widens* delivery to org members — an
-- improvement, never a regression.

-- --- Re-run the NULL-only org_id backfill (belt-and-suspenders) ---------------
-- Mirrors 20260725100200; only fills NULLs so it's a no-op on rows the app
-- already stamps at insert time. Maximises rows covered by the org policies.
with first_org as (
  select distinct on (user_id) user_id, org_id
  from public.organization_members
  where user_id is not null and org_id is not null
  order by user_id, created_at asc
)
update public.sched_projects p
  set org_id = fo.org_id
  from first_org fo
  where p.owner_user_id = fo.user_id and p.org_id is null;

with first_org as (
  select distinct on (user_id) user_id, org_id
  from public.organization_members
  where user_id is not null and org_id is not null
  order by user_id, created_at asc
)
update public.sched_batches b
  set org_id = fo.org_id
  from first_org fo
  where b.owner_user_id = fo.user_id and b.org_id is null;

update public.sched_candidates c
  set org_id = b.org_id
  from public.sched_batches b
  where c.batch_id = b.id and c.org_id is null and b.org_id is not null;

-- Slots inherit via their candidate's batch (candidate_id is the always-present
-- link from the base migration; candidate -> batch -> org).
update public.sched_slots s
  set org_id = b.org_id
  from public.sched_candidates c
  join public.sched_batches b on b.id = c.batch_id
  where s.candidate_id = c.id and s.org_id is null and b.org_id is not null;

-- Messages: private threads inherit via their candidate's batch.
update public.sched_messages m
  set org_id = b.org_id
  from public.sched_candidates c
  join public.sched_batches b on b.id = c.batch_id
  where m.candidate_id = c.id and m.org_id is null and b.org_id is not null;

-- --- RLS enable (idempotent no-op — already enabled at table creation) --------
alter table public.sched_projects   enable row level security;
alter table public.sched_batches    enable row level security;
alter table public.sched_candidates enable row level security;
alter table public.sched_slots      enable row level security;
alter table public.sched_messages   enable row level security;

-- --- Standard org-role policies ----------------------------------------------
-- sched_projects
drop policy if exists "sched_projects_org_select" on public.sched_projects;
create policy "sched_projects_org_select" on public.sched_projects
  for select using (public.has_org_role(org_id, 'viewer'));
drop policy if exists "sched_projects_org_insert" on public.sched_projects;
create policy "sched_projects_org_insert" on public.sched_projects
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_projects_org_update" on public.sched_projects;
create policy "sched_projects_org_update" on public.sched_projects
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_projects_org_delete" on public.sched_projects;
create policy "sched_projects_org_delete" on public.sched_projects
  for delete using (public.has_org_role(org_id, 'member'));

-- sched_batches
drop policy if exists "sched_batches_org_select" on public.sched_batches;
create policy "sched_batches_org_select" on public.sched_batches
  for select using (public.has_org_role(org_id, 'viewer'));
drop policy if exists "sched_batches_org_insert" on public.sched_batches;
create policy "sched_batches_org_insert" on public.sched_batches
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_batches_org_update" on public.sched_batches;
create policy "sched_batches_org_update" on public.sched_batches
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_batches_org_delete" on public.sched_batches;
create policy "sched_batches_org_delete" on public.sched_batches
  for delete using (public.has_org_role(org_id, 'member'));

-- sched_candidates
drop policy if exists "sched_candidates_org_select" on public.sched_candidates;
create policy "sched_candidates_org_select" on public.sched_candidates
  for select using (public.has_org_role(org_id, 'viewer'));
drop policy if exists "sched_candidates_org_insert" on public.sched_candidates;
create policy "sched_candidates_org_insert" on public.sched_candidates
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_candidates_org_update" on public.sched_candidates;
create policy "sched_candidates_org_update" on public.sched_candidates
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_candidates_org_delete" on public.sched_candidates;
create policy "sched_candidates_org_delete" on public.sched_candidates
  for delete using (public.has_org_role(org_id, 'member'));

-- sched_slots
drop policy if exists "sched_slots_org_select" on public.sched_slots;
create policy "sched_slots_org_select" on public.sched_slots
  for select using (public.has_org_role(org_id, 'viewer'));
drop policy if exists "sched_slots_org_insert" on public.sched_slots;
create policy "sched_slots_org_insert" on public.sched_slots
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_slots_org_update" on public.sched_slots;
create policy "sched_slots_org_update" on public.sched_slots
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_slots_org_delete" on public.sched_slots;
create policy "sched_slots_org_delete" on public.sched_slots
  for delete using (public.has_org_role(org_id, 'member'));

-- sched_messages
drop policy if exists "sched_messages_org_select" on public.sched_messages;
create policy "sched_messages_org_select" on public.sched_messages
  for select using (public.has_org_role(org_id, 'viewer'));
drop policy if exists "sched_messages_org_insert" on public.sched_messages;
create policy "sched_messages_org_insert" on public.sched_messages
  for insert with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_messages_org_update" on public.sched_messages;
create policy "sched_messages_org_update" on public.sched_messages
  for update using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));
drop policy if exists "sched_messages_org_delete" on public.sched_messages;
create policy "sched_messages_org_delete" on public.sched_messages
  for delete using (public.has_org_role(org_id, 'member'));
