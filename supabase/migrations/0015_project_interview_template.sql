-- Per-project interview question template.
--
-- Lets a project owner pre-register the question set the interview
-- analyzer should align answers to, instead of having the AI infer
-- "standard questions" from the interviews themselves. Stored as
-- jsonb so we can carry both the question list and metadata about
-- the source file (filename, parsed_at) in one column.
--
-- Shape:
--   {
--     "questions":      ["...", "..."],
--     "source_filename": "guide.xlsx" | "guide.docx",
--     "uploaded_at":    "2026-05-13T12:34:56.000Z"
--   }
--
-- nullable: a project without a template falls back to the original
-- automatic clustering pipeline.

alter table public.projects
  add column if not exists interview_template jsonb;
