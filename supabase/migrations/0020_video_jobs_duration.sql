-- Store video duration so we can compute length-based credit charges.
alter table public.video_jobs
  add column if not exists duration_seconds int;
