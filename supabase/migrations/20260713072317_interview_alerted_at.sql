-- Interview failure-alert dedup watermark.
--
-- The failure-alert cron (/api/cron/interview-failure-alert) sweeps failed and
-- stuck interview jobs on a 5–10 min cadence and emails a founder digest. To
-- avoid re-notifying the same failure on every run, each row that has been
-- included in a digest gets alerted_at stamped; the cron only selects rows
-- where alerted_at IS NULL.
--
-- Both columns are nullable (additive, no backfill). Existing rows read as
-- "not yet alerted", but the cron's freshness gates keep it from back-alerting
-- old noise: error rows are surfaced once and immediately stamped, and
-- stuck-pending rows are gated on updated_at age (15 min) + docs=0.
alter table public.interview_jobs
  add column if not exists alerted_at timestamptz;

alter table public.interview_toplines
  add column if not exists alerted_at timestamptz;
