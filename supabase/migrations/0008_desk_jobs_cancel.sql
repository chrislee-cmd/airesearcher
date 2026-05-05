-- Desk Research: cooperative cancellation. The background runner can't be
-- killed from outside (Vercel function), so we flip a flag in the row and the
-- runner checks it between phases / after each crawl task.

alter table public.desk_jobs
  add column if not exists cancel_requested boolean not null default false;

-- Extend status enum with 'cancelled'.
alter table public.desk_jobs drop constraint if exists desk_jobs_status_check;
alter table public.desk_jobs
  add constraint desk_jobs_status_check
  check (status in (
    'queued','expanding','crawling','summarizing','done','error','cancelled'
  ));
