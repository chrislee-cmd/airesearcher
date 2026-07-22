-- Recruiting-scheduling — broadcast send modes.
--
-- The chat had exactly two shapes: a single broadcast announcement (to everyone)
-- and 1:1 private threads. This adds two orthogonal axes to broadcast messages so
-- the admin can pick, per message:
--
--   * is_announcement — HOW it renders on the participant side.
--       true  = 공지  → banner (the existing behavior; kept as the default).
--       false = 발송  → a chat bubble in the message thread.
--   * batch_id        — WHO it reaches.
--       null  = 전체   → every participant (the existing behavior).
--       set   = 그룹별 → only participants whose candidate is in that batch.
--
-- The four broadcast modes are the (is_announcement × batch_id) combinations;
-- private (scope='private', candidate_id set) is untouched.
--
-- Purely additive — no CHECK drop/rewrite, no backfill:
--   * is_announcement DEFAULT true means every pre-existing broadcast row stays a
--     global announcement (banner), so the "전체 공지" behavior is preserved with
--     zero regression.
--   * batch_id is nullable (null = 전체), so old rows read as global.
--   * The scope↔candidate_id CHECK still holds: a group broadcast is still
--     scope='broadcast' with candidate_id NULL — only batch_id narrows its reach.
-- Additive-only keeps the merge-to-main auto-apply path (PROJECT.md §7.5) safe.

alter table public.sched_messages
  add column if not exists is_announcement boolean not null default true;

-- null = 전체 (all participants); set = scoped to that batch's candidates.
-- Cascade so deleting a group also removes its scoped announcements/sends.
alter table public.sched_messages
  add column if not exists batch_id uuid
    references public.sched_batches(id) on delete cascade;

create index if not exists sched_messages_batch_idx
  on public.sched_messages (batch_id);
