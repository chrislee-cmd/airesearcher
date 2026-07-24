-- Standalone slot tenancy anchor.
--
-- A slot with no candidate AND no batch (a "standalone" titled event created
-- from the calendar's "전체" view) had no tenancy anchor. The page read scopes
-- slots by `batch_id in (groupIds)`, so a batch-less row was writable (the POST
-- route allows candidate-less titled events) but invisible to every account,
-- including super-admin — a write/read contract mismatch (the ghost slot bug).
--
-- owner_user_id records who created the slot so the read can include standalone
-- slots the caller may see: super-admin sees all standalone rows; an org member
-- sees only standalone rows owned within their org. Pre-existing rows stay null
-- and remain super-admin-only (no backfill needed).
--
-- Additive + idempotent (nullable column, `if not exists`, no drop/rename/type
-- change), so merge auto-apply handles it.

alter table public.sched_slots
  add column if not exists owner_user_id uuid
    references auth.users (id) on delete set null;

create index if not exists sched_slots_owner_idx
  on public.sched_slots (owner_user_id);
