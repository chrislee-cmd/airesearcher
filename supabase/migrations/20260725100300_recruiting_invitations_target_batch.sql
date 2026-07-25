-- journey P0 bridge — record the target group for an invitation request.
--
-- The bridge lets a user send selected form responses to a specific candidate
-- group (batch) or to the project inbox. This records that intent so the
-- approval hook (PATCH status='sent') ingests into the right batch.
--   target_batch_id NULL  → ingest into the form's project inbox (resolve-or-create).
--   target_batch_id set   → ingest into that batch.
--
-- Soft reference (no FK): the batch is validated in code against the form's
-- project at approval time, and we never want a deleted batch to orphan the
-- historical invitation record. Additive + idempotent — auto-applies on merge.

alter table public.recruiting_invitations
  add column if not exists target_batch_id uuid;
