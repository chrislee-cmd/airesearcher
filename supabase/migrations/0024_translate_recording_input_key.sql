-- 0024_translate_recording_input_key.sql
--
-- AI 동시통역 — split recording into input-only (source) and output-only
-- (translated TTS) audio. Existing `storage_key` now holds the OUTPUT
-- (translated) webm path; new column holds the INPUT (source) webm path.
-- Pre-existing rows from PR-B's initial mixed-audio recording remain
-- valid: input_storage_key stays NULL and the download endpoint treats
-- those as "output-only" (legacy mixed file served via the output path).
-- New recordings always populate both.

alter table public.translate_recordings
  add column input_storage_key text;
