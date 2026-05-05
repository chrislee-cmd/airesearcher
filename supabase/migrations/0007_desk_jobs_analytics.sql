-- Desk Research: hold the LLM-derived analytics that back up the report's
-- claims (topic shares, sentiment, keyword comparison, etc). Single jsonb
-- column so we don't pre-commit to a chart shape.

alter table public.desk_jobs
  add column if not exists analytics jsonb;
