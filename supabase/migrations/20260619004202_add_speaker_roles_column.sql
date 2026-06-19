-- 20260619004202_add_speaker_roles_column.sql
--
-- Adds a `speaker_roles` jsonb column to `transcript_jobs` for the LLM-driven
-- role classification pass. The cleanup pass (0029) already produces a stable
-- post-merge speaker set; this pass maps each diarized `speaker_N` to a
-- 2D label of `{role: 'interviewer'|'interviewee'|'unknown', n: <int>}` so the
-- preview/download routes can render Korean labels like "질문자 1", "응답자 2".
--
-- Shape:
--   {
--     "assignments": {
--       "speaker_1": { "role": "interviewer", "n": 1 },
--       "speaker_2": { "role": "interviewee", "n": 1 }
--     },
--     "model": "claude-haiku-4-5-20251001",
--     "generated_at": "2026-06-19T..."
--   }
--
-- Nullable on purpose: jobs created before this migration, English-Deepgram
-- jobs (cleanup/role passes skipped today), and runs where the LLM returned
-- low-confidence all legitimately leave it NULL — the UI falls back to
-- "화자 N" labels in that case.

alter table public.transcript_jobs
  add column if not exists speaker_roles jsonb;
