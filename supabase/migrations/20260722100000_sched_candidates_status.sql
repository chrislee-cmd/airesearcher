-- Candidate-level status for the recruiting-scheduling admin bulk actions
-- (PR-A). Distinct from sched_slots.status (a per-slot proposed/confirmed/
-- cancelled lifecycle): this is a coarse per-candidate flag the admin sets in
-- bulk from the list ("개인 확정" → status = 'confirmed'). Defaults to 'pending'
-- so every existing row reads as not-yet-confirmed. Additive (nullable-safe via
-- default) so the merge auto-apply gate ships it without manual review.
alter table public.sched_candidates
  add column if not exists status text not null default 'pending';
