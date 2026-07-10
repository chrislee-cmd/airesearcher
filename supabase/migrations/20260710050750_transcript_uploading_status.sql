-- transcript_jobs.status: add 'uploading' for row-first handoff.
--
-- Root cause fixed here: the job row used to be inserted only AFTER the upload
-- finished AND after the concurrency gate admitted the file. A large upload
-- that failed/stalled, or a gate rejection, left a storage object with no DB
-- row (orphan) — the file "silently disappeared" (11 orphaned paid files
-- observed 2026-07-10). Row-first inserts a per-file row at UPLOAD START with
-- status='uploading' so a row always exists and shows up in the list.
--
-- State machine after this change:
--   uploading  → (upload ok)   submitting → transcribing → done
--   uploading  → (upload fail) error
-- The existing statuses are unchanged; we only widen the check constraint.
alter table public.transcript_jobs
  drop constraint if exists transcript_jobs_status_check;
alter table public.transcript_jobs
  add constraint transcript_jobs_status_check
  check (status in ('uploading','queued','submitting','transcribing','done','error'));
