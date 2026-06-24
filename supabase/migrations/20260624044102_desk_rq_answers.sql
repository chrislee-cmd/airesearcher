-- 20260624044102_desk_rq_answers.sql
--
-- PR-2 of the desk research overhaul. Adds one jsonb column to `desk_jobs`
-- so the new multi-pass synthesis (draft → critique → revise) can persist
-- per-RQ answers alongside the existing scoping/extracting artifacts.
--
-- rq_answers:
--   [{
--     rq_id: 'rq-1',
--     answer_md: '...',                                   -- final answer (markdown, citations as [label](url))
--     confidence: 'high' | 'medium' | 'low',
--     weaknesses: string[],                               -- self-critique weaknesses
--     missing_data: string[],                             -- gaps for follow-up research
--     cited_article_urls: string[]                        -- urls referenced in answer_md
--   }]
--   Filled in the new `drafting` / `critiquing` / `revising` phases (Sonnet,
--   ~2-3 calls per RQ) before the final report synthesis. Failures degrade
--   gracefully — column may be `[]` or null without blocking summarize.
--
-- Column is nullable so old rows stay valid and the runner can write
-- partials. PR-3 will start surfacing the per-RQ critique trail in the UI.

alter table public.desk_jobs
  add column if not exists rq_answers jsonb;
