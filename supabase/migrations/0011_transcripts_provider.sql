-- Multi-provider transcription: add provider/model columns to transcript_jobs.
--
-- Existing rows are Deepgram-only; backfill accordingly. New providers
-- (ElevenLabs Scribe v2 to start) populate `provider`, `model`, and
-- `provider_request_id`. The legacy `deepgram_request_id` column stays for
-- now to avoid breaking older job rows; new code reads/writes
-- `provider_request_id`.

alter table public.transcript_jobs
  add column if not exists provider text not null default 'deepgram'
    check (provider in ('deepgram','elevenlabs')),
  add column if not exists model text,
  add column if not exists provider_request_id text;

update public.transcript_jobs
  set provider_request_id = deepgram_request_id
  where provider_request_id is null
    and deepgram_request_id is not null;

create index if not exists transcript_jobs_provider_request_id_idx
  on public.transcript_jobs (provider_request_id);
