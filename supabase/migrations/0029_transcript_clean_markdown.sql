-- 0029_transcript_clean_markdown.sql
--
-- Adds a `clean_markdown` column to `transcript_jobs` for the post-processing
-- cleanup pass (per-turn LLM rewrite that removes Korean fillers / stutters /
-- obvious mishears). The original `markdown` is intentionally preserved so the
-- UI can fall back when the cleanup pass is skipped or low-confidence, and so
-- PR D (manual review) can offer a side-by-side diff.
--
-- Nullable on purpose: jobs created before this migration, English-Deepgram
-- jobs (no cleanup pass), and runs where the LLM returned low-confidence all
-- legitimately leave it NULL.

alter table public.transcript_jobs
  add column if not exists clean_markdown text;
