-- AI UT input language — the participant language the researcher picks at
-- session creation, threaded to ElevenLabs Scribe as `language_code` so the STT
-- has an explicit hint instead of falling back to auto-detect (the single
-- largest transcription-accuracy regression, per the Scribe pipeline notes).
--
-- Additive + nullable: existing rows are unaffected (no backfill). New sessions
-- always carry a value because POST /api/ut/sessions now *requires* it (zod +
-- client guard). Only legacy rows (null) keep the old auto-detect behaviour at
-- (re-)transcribe time — full backward compatibility. Stores the internal
-- language code from src/lib/transcripts/languages.ts (e.g. 'ko', 'zh-TW'); the
-- transcribe pipeline maps it to the provider `language_code` via getLanguage().
alter table public.ut_sessions
  add column if not exists input_language text;
