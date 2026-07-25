-- journey P0 bridge — introduce org_id on the sched_* stack (GAP-AUDIT §1-12,
-- CONTEXTRECSCHED B.4 tenancy debt).
--
-- Until now sched_* carried only owner_user_id and tenancy was 100% code-scoped
-- (getSchedulingAccess → the set of owner_user_ids sharing an org). This adds an
-- org_id anchor so a form-anchored surface (recruiting fullview) can map form →
-- org → members directly, and so future scoping can simplify to org_id.
--
-- SCOPE NOTE (conservative): this migration only ADDS + BACKFILLS org_id. It does
-- NOT change any existing owner_user_id-based scoping in code — that stays as the
-- tested tenancy wall (regression 0, per the spec's 동등성 constraint). org_id is
-- laid down as the structural foundation the form-anchor gate reads.
--
-- All additive: add nullable FK columns + indexes, then a NULL-only backfill
-- (UPDATE, non-destructive). Auto-applies on merge to main.

alter table public.sched_projects
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.sched_batches
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.sched_candidates
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.sched_slots
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.sched_messages
  add column if not exists org_id uuid references public.organizations(id) on delete set null;

create index if not exists sched_projects_org_idx  on public.sched_projects (org_id);
create index if not exists sched_batches_org_idx    on public.sched_batches (org_id);
create index if not exists sched_candidates_org_idx on public.sched_candidates (org_id);
create index if not exists sched_slots_org_idx      on public.sched_slots (org_id);
create index if not exists sched_messages_org_idx   on public.sched_messages (org_id);

-- Backfill from each owner's FIRST org membership (mirrors getActiveOrg, which
-- picks the earliest-created membership). Only fills NULLs so re-runs are no-ops.
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

-- Candidates inherit their batch's org.
update public.sched_candidates c
  set org_id = b.org_id
  from public.sched_batches b
  where c.batch_id = b.id and c.org_id is null and b.org_id is not null;

-- Slots: prefer their own owner_user_id → org; else fall back to their batch.
with first_org as (
  select distinct on (user_id) user_id, org_id
  from public.organization_members
  where user_id is not null and org_id is not null
  order by user_id, created_at asc
)
update public.sched_slots s
  set org_id = fo.org_id
  from first_org fo
  where s.owner_user_id = fo.user_id and s.org_id is null;

update public.sched_slots s
  set org_id = b.org_id
  from public.sched_batches b
  where s.batch_id = b.id and s.org_id is null and b.org_id is not null;

-- Messages inherit from their batch, then their candidate's batch.
update public.sched_messages m
  set org_id = b.org_id
  from public.sched_batches b
  where m.batch_id = b.id and m.org_id is null and b.org_id is not null;

update public.sched_messages m
  set org_id = b.org_id
  from public.sched_candidates c
  join public.sched_batches b on b.id = c.batch_id
  where m.candidate_id = c.id and m.org_id is null and b.org_id is not null;
