-- Recruiting-scheduling — message edit timestamp.
--
-- Round-3 lets the admin edit a broadcast announcement/message after sending it
-- (typo fix, correction). To surface a "수정됨" marker on the participant/admin
-- side we need to know whether a row has been edited, so add an updated_at that
-- the PATCH handler stamps on each edit.
--
-- Purely additive — nullable, no default, no backfill:
--   * null  = never edited (the vast majority of existing rows). The UI shows the
--     "수정됨" label only when updated_at is present AND later than created_at, so a
--     null column reads exactly as the pre-edit behavior — zero regression.
--   * Only the [id] PATCH route ever writes it (updated_at = now()); POST leaves it
--     null. No trigger, keeping the merge-to-main auto-apply path (§7.5) additive.

alter table public.sched_messages
  add column if not exists updated_at timestamptz;
