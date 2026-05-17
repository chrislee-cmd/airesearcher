-- Interview analysis: persist the consolidated insights (second-pass
-- vertical synthesis) alongside the raw matrix. Lets the workspace
-- content endpoint regenerate the markdown digest server-side without
-- having to recompute LLM output. Nullable so older rows stay valid.

alter table public.interview_jobs
  add column if not exists consolidated jsonb;
