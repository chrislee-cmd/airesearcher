-- 20260624122702_desk_research_extract.sql
--
-- PR-1 of the 4-pass desk research overhaul. Adds two jsonb columns to
-- `desk_jobs` so the new "scoping" and "extracting" phases can persist their
-- intermediate artifacts alongside the existing crawl/summary state.
--
-- research_questions:
--   [{ id: 'rq-1', question: '...', category: 'market_size'|..., importance: 1..5 }]
--   Filled in the `scoping` phase (Sonnet, 1 call) right after keyword expansion.
--
-- claims:
--   [{
--     article_url: '...',
--     kind: 'quant' | 'entity',
--     value?: '...', unit?: '...', subject?: '...',           -- quant
--     name?: '...', role?: 'company'|'person'|'product'|'org', -- entity
--     source_quote: '...',
--     rq_ids: ['rq-1', ...],
--     confidence: 'direct' | 'paraphrased' | 'speculation',
--     tier: 'T1' | 'T2' | 'T3' | 'unknown'                    -- inherited from source
--   }]
--   Filled in the `extracting` phase (Haiku, ~50 parallel calls) before the
--   final report. Failures degrade gracefully — the column may be `[]` or null
--   without blocking summarize.
--
-- Both columns are nullable so old rows stay valid and the runner can write
-- partials. PR-2 will start consuming these to drive the new report shape.

alter table public.desk_jobs
  add column if not exists research_questions jsonb,
  add column if not exists claims jsonb;
