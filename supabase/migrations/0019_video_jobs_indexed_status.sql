-- Add 'indexed' status: Twelvelabs indexing done, waiting for user to submit analysis prompt.
alter table public.video_jobs
  drop constraint if exists video_jobs_status_check;

alter table public.video_jobs
  add constraint video_jobs_status_check
  check (status in ('uploading','indexing','indexed','analyzing','done','error'));
