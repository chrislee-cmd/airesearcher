-- interview_toplines: add 'cancelled' terminal status (생성 강제종료 — 탑라인).
--
-- Topline generation is a durable map-reduce job (resume hops + GET self-heal +
-- cron sweep #1016). Those re-kick paths already gate on status='generating',
-- so a 'cancelled' row is never revived by them. The cancel endpoint flips the
-- row to 'cancelled' and runTopline's terminal writes are guarded with
-- .eq('status','generating') so an in-flight hop can't overwrite the cancel.
--
-- Original check (20260706114519): status in ('idle','generating','done','error').
-- Widen it to include 'cancelled'. Additive — existing statuses unchanged.

alter table public.interview_toplines
  drop constraint if exists interview_toplines_status_check;
alter table public.interview_toplines
  add constraint interview_toplines_status_check
  check (status in ('idle', 'generating', 'done', 'error', 'cancelled'));
