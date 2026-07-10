-- QA text feedback — extend qa_feedbacks so a plain-text note can live in the
-- same table as voice feedback (PR: qa-text-feedback-note). A text note has no
-- audio recording, so:
--   1. audio_storage_key becomes nullable (text rows carry null there).
--   2. a `source` discriminator ('voice' | 'text') distinguishes the two.
-- Existing rows are all voice recordings, so `source` defaults to 'voice' and
-- backfills them automatically. Text rows are inserted client-side with
-- status 'done' directly (no async transcribe step — the transcript IS the
-- user's typed content), reusing the same RLS (self_insert + super_admin_read).
--
-- ⚠️ This migration is NOT auto-applied by the Vercel build (PROJECT.md §7.5).
-- Run `supabase db push --linked --yes` against prod after merge, or text
-- feedback inserts will fail the NOT NULL constraint on audio_storage_key.

alter table public.qa_feedbacks
  alter column audio_storage_key drop not null;

alter table public.qa_feedbacks
  add column if not exists source text not null default 'voice'
    check (source in ('voice', 'text'));
