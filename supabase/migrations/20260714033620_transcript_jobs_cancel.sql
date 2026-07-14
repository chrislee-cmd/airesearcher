-- transcript_jobs: cooperative cancel support (생성 강제종료 — 전사록).
--
-- Mirrors the desk_jobs cancel pattern (0008_desk_jobs_cancel.sql):
--   * cancel_requested boolean — a request-to-cancel flag. Transcripts have no
--     long-running in-process runner to poll it (the heavy work is at the
--     provider — ElevenLabs/Deepgram), so cancel is finalized directly by the
--     cancel endpoint flipping status → 'cancelled'. The flag is kept for
--     parity/audit and so the poll endpoint can skip a late completion write.
--   * 'cancelled' status — a terminal state the client poll already treats as
--     terminal (transcript-job-provider terminal recognition). Widen the check
--     constraint so the row can hold it.
--
-- State machine after this change:
--   uploading/submitting/transcribing → (user cancel) cancelled  (terminal)
-- Existing statuses unchanged; additive column + widened constraint only.

alter table public.transcript_jobs
  add column if not exists cancel_requested boolean not null default false;

alter table public.transcript_jobs
  drop constraint if exists transcript_jobs_status_check;
alter table public.transcript_jobs
  add constraint transcript_jobs_status_check
  check (status in ('uploading','queued','submitting','transcribing','done','error','cancelled'));
