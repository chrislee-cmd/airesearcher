-- Intake staging for scheduling candidates (card 588). Uploaded/imported lists
-- used to land straight in sched_candidates and surface in the ②일정 tab,
-- skipping the ①응답 selection step that Google Forms responses go through
-- (bridge). This adds a row-level `stage` so intake can sit in ①응답 until the
-- user promotes selected rows to the roster (②일정).
--
--   'intake'  — landed via CSV/Sheets upload, awaiting selection. Shown only in
--               ①응답 (upload-list source segment); excluded from ②일정 reads.
--   'roster'  — promoted (or bridged from a form response) — visible in ②일정.
--
-- DEFAULT 'roster' keeps every pre-existing row exactly where it is today
-- (regression 0). Only new uploads/imports stamp 'intake'. The column is
-- additive: read paths that predate it degrade to treating every row as
-- 'roster' (current behaviour), so a preview DB on the old schema never drops
-- or hides data.
alter table public.sched_candidates
  add column if not exists stage text not null default 'roster';

alter table public.sched_candidates
  drop constraint if exists sched_candidates_stage_chk;
alter table public.sched_candidates
  add constraint sched_candidates_stage_chk
  check (stage in ('intake', 'roster'));

create index if not exists sched_candidates_batch_stage_idx
  on public.sched_candidates (batch_id, stage);
