-- AI UT (moderated session, "방식 D") — schema + two private storage buckets
-- + RLS. A user records a usability-testing session on their OWN browser while
-- looking at a real site and speaking freely: the browser captures an
-- in-app screen recording (getDisplayMedia → webm) plus a mic-voice track, and
-- uploads both to private buckets. Voice is transcribed asynchronously through
-- the SAME ElevenLabs Scribe pipeline QA voice-feedback uses — but the DATA is
-- fully separate: its own `ut_sessions` table + own buckets. `qa_feedbacks` /
-- `qa-feedback-audio` are NEVER touched by this feature.
--
-- Status walk (server-driven): recording → uploading → transcribing →
-- done (or error). `transcript` starts null and fills once Scribe returns.
--
-- Storage path convention (minted server-side, mirrored by the RLS folder
-- check below):
--   {user_id}/{session_id}/audio.webm         (bucket ut-audio)
--   {user_id}/{session_id}/recording.webm     (bucket ut-recording)
-- The leading {user_id} segment is what the per-user storage policies match
-- on, so a user can only ever read/write under their own prefix.
--
-- ⚠ PRIVACY (critical): the screen recording can capture login passwords and
-- card numbers (a login→checkout scenario is a normal UT task). Both buckets
-- are therefore PRIVATE, readable only via short-lived signed URLs minted by
-- the server for the owner or a super-admin. Direct client reads are scoped by
-- the {user_id} prefix RLS below, and there is NO public bucket. Retention:
-- these objects are sensitive and SHOULD be rolled off on a schedule — see the
-- retention note at the bottom of this file; a cleanup cron is a follow-up.

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.ut_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  org_id                uuid,                        -- best-effort active org (nullable)
  target_url            text,                        -- the site the user tested
  status                text not null default 'recording'
                        check (status in ('recording', 'uploading', 'transcribing', 'done', 'error')),
  audio_storage_key     text,                        -- path inside ut-audio bucket (nullable until upload)
  recording_storage_key text,                        -- path inside ut-recording bucket (nullable until upload)
  transcript            text,                        -- async Scribe result (nullable)
  duration_ms           integer,
  meta                  jsonb not null default '{}', -- user agent, error detail, etc.
  started_at            timestamptz,
  ended_at              timestamptz,
  created_at            timestamptz not null default now()
);

-- Primary access pattern: a user's own sessions, newest first (widget list +
-- polling). Composite so the index alone satisfies the ordered scan.
create index if not exists ut_sessions_user_created_idx
  on public.ut_sessions (user_id, created_at desc);

-- ── Table RLS ────────────────────────────────────────────────────────────
-- Strict: the client may NOT insert or select beyond its own rows; the API
-- routes (service role) are the only write path. We keep a self-select policy
-- so a future read-through of the caller's own sessions works, plus a
-- super-admin select for support.
alter table public.ut_sessions enable row level security;

-- A user reads only their own sessions. (No self-insert/update/delete — every
-- write goes through the service role in the API routes. Unlike qa_feedbacks,
-- even the INSERT is server-only here, since the row is created by
-- POST /api/ut/sessions rather than by the browser.)
create policy "ut_sessions_self_read" on public.ut_sessions
  for select using (auth.uid() = user_id);

-- Super admin reads everything. Same JWT-claim gate as qa_feedbacks: the
-- `authenticated` role has no SELECT on auth.users, so an in-policy subquery
-- would fail — `auth.jwt() ->> 'email'` is the supported way to read the
-- caller's email inside a policy.
create policy "ut_sessions_super_admin_read" on public.ut_sessions
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );

-- ── Storage buckets (private) ────────────────────────────────────────────
-- Two separate buckets so retention / access can diverge later (voice may be
-- kept for transcript QA while the visually-sensitive screen recording is
-- rolled off sooner). Created here so `supabase db push` / the merge auto-apply
-- workflow fully provisions the feature without a Dashboard step; idempotent.
--   ut-audio     : mic voice, 50 MB cap  (short clips → Scribe)
--   ut-recording : screen webm, 500 MB cap (a full session can be large)
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('ut-audio',     'ut-audio',     false, 52428800),
  ('ut-recording', 'ut-recording', false, 524288000)
on conflict (id) do nothing;

-- ── Storage RLS (storage.objects) ────────────────────────────────────────
-- Per-user prefix scoping for both buckets. Uploads happen client→storage via
-- server-minted signed upload URLs (signed URLs bypass RLS), but these policies
-- keep any direct authenticated read/write correctly scoped as defence-in-depth.
create policy "ut_audio_self_rw" on storage.objects
  for all using (
    bucket_id = 'ut-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ut-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "ut_recording_self_rw" on storage.objects
  for all using (
    bucket_id = 'ut-recording'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ut-recording'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Super admin reads every object in both buckets (support / moderation).
create policy "ut_audio_super_admin_read" on storage.objects
  for select using (
    bucket_id = 'ut-audio'
    and (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );

create policy "ut_recording_super_admin_read" on storage.objects
  for select using (
    bucket_id = 'ut-recording'
    and (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );

-- ── Retention (privacy) ──────────────────────────────────────────────────
-- These recordings can contain credentials / payment details. They should NOT
-- be kept indefinitely. A follow-up cron (e.g. /api/cron/ut-recording-rolloff)
-- should delete objects + null the storage keys for sessions older than a fixed
-- window (proposed: 30 days for ut-recording, longer only if the transcript
-- alone is retained). Documenting the intent here so the obligation is visible
-- at the schema level; the deletion job lands separately.
