-- 0023_translate_recordings.sql
--
-- AI 동시통역 — paid audio download.
--
-- The host's browser captures (mic/tab source) + (translated TTS) into a
-- single mixed WebM via MediaRecorder, uploads it to the existing
-- `audio-uploads` bucket under `<host_user_id>/translate-recordings/...`,
-- and the row below tracks lifecycle + paywall state.
--
-- Status transitions:
--   recording  → uploaded   (PATCH finalize after MediaRecorder.stop)
--   uploaded   → unlocked   (POST /unlock, after credit charge)
--   <anything> → failed     (server-side error path)
--
-- Only `unlocked` rows are downloadable via the signed-URL endpoint.

create table public.translate_recordings (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null
                  references public.translate_sessions(id) on delete cascade,
  org_id          uuid not null
                  references public.organizations(id) on delete cascade,
  host_user_id    uuid not null references auth.users(id),

  -- path inside the existing `audio-uploads` Supabase Storage bucket.
  -- always under the host_user_id prefix so the existing per-user RLS on
  -- storage.objects keeps the file private without new policies.
  storage_key     text not null,

  mime_type       text not null default 'audio/webm',
  size_bytes      bigint,
  duration_sec    integer,

  status          text not null default 'recording'
                  check (status in ('recording','uploaded','unlocked','failed')),

  unlocked_at     timestamptz,
  -- mirror of the actual ledger debit so the row is self-describing for
  -- audits without joining credit_transactions every time.
  credits_spent   integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index translate_recordings_session_idx
  on public.translate_recordings (session_id);

create index translate_recordings_org_idx
  on public.translate_recordings (org_id, created_at desc);

-- One in-progress or finalized recording per session is the common case.
-- We do NOT enforce uniqueness — a host who restarts after a failure
-- should be able to retry without manual cleanup. The console always
-- picks the most recent row for a session.

create or replace function public.touch_translate_recordings()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_translate_recordings
  on public.translate_recordings;
create trigger trg_touch_translate_recordings
  before update on public.translate_recordings
  for each row execute function public.touch_translate_recordings();

alter table public.translate_recordings enable row level security;

-- Org members can read recording metadata (so any teammate can see "host
-- has paid for the audio" status on a finished session).
create policy "translate_recordings_org_select"
on public.translate_recordings for select
using (
  exists (
    select 1 from public.organization_members m
    where m.org_id = translate_recordings.org_id
      and m.user_id = auth.uid()
  )
);

-- Only the host who started the session can create/update their recording
-- rows. Service-role bypasses RLS for the charge + unlock flow.
create policy "translate_recordings_host_insert"
on public.translate_recordings for insert
with check (
  host_user_id = auth.uid()
  and exists (
    select 1 from public.translate_sessions s
    where s.id = translate_recordings.session_id
      and s.host_user_id = auth.uid()
  )
);

create policy "translate_recordings_host_update"
on public.translate_recordings for update
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());
