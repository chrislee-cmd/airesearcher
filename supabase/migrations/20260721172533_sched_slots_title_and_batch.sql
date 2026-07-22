-- Recruiting-scheduling PR-B — free-text slot titles + candidate-optional events.
--
-- The calendar used to hold only per-candidate interviews. Admins now want to
-- add general titled events (e.g. "주간 미팅") that aren't tied to a candidate.
-- Three additive changes make that possible:
--
--   1. title       — free-text label rendered on the calendar block. Optional;
--      candidate slots fall back to the candidate's name when blank.
--   2. batch_id     — scopes a slot to its batch directly. Previously a slot
--      belonged to a batch only transitively through its candidate, so a
--      candidate-less event had no batch to live in. Stored explicitly now.
--   3. candidate_id becomes nullable — a titled event may have no candidate.
--
-- Existing candidate slots are backfilled with batch_id copied from the
-- candidate so the batch-scoped fetch keeps returning them. All changes are
-- additive (no drop/rename/type change), so merge auto-apply handles them.

alter table public.sched_slots
  add column if not exists title text;

alter table public.sched_slots
  add column if not exists batch_id uuid
    references public.sched_batches(id) on delete cascade;

-- Backfill batch_id for pre-existing candidate slots from their candidate.
update public.sched_slots s
  set batch_id = c.batch_id
  from public.sched_candidates c
  where s.candidate_id = c.id
    and s.batch_id is null;

-- A titled event may stand alone with no candidate attached.
alter table public.sched_slots
  alter column candidate_id drop not null;

create index if not exists sched_slots_batch_idx
  on public.sched_slots (batch_id);
