-- QA voice feedback — schema + private audio bucket + RLS (PR1 of the QA
-- voice-agent epic). A user in QA mode records a voice note via the voice
-- agent; the browser uploads the audio to the `qa-feedback-audio` bucket and
-- inserts one `qa_feedbacks` row. Transcription happens asynchronously (a
-- later PR), so `transcript` starts null and `status` walks
-- pending → transcribing → done (or error).
--
-- Storage path convention (enforced client-side, mirrored by the RLS folder
-- check below):
--   {user_id}/{session_id}/{timestamp}-{random}.webm
-- The leading {user_id} segment is what the per-user storage policies match
-- on, so a user can only ever read/write under their own prefix.

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.qa_feedbacks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null,               -- groups feedbacks in one QA session
  audio_storage_key text not null,               -- path inside qa-feedback-audio bucket
  transcript        text,                        -- async transcription result (nullable)
  page_url          text,                        -- page the feedback was left on (context)
  duration_seconds  integer,
  status            text not null default 'pending'
                    check (status in ('pending', 'transcribing', 'done', 'error')),
  meta              jsonb not null default '{}',  -- user agent, browser info, etc.
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists qa_feedbacks_user_id_idx
  on public.qa_feedbacks (user_id);
create index if not exists qa_feedbacks_session_id_idx
  on public.qa_feedbacks (session_id);
create index if not exists qa_feedbacks_created_at_idx
  on public.qa_feedbacks (created_at desc);

-- keep updated_at honest (the column is meaningless without a trigger)
create or replace function public.touch_qa_feedbacks()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_qa_feedbacks on public.qa_feedbacks;
create trigger trg_touch_qa_feedbacks
  before update on public.qa_feedbacks
  for each row execute function public.touch_qa_feedbacks();

-- ── Table RLS ────────────────────────────────────────────────────────────
alter table public.qa_feedbacks enable row level security;

-- A user reads only their own feedback…
create policy "qa_feedbacks_self_read" on public.qa_feedbacks
  for select using (auth.uid() = user_id);

-- …and inserts only rows attributed to themselves (no update/delete — QA
-- feedback is append-only from the user's side; transcription writes happen
-- via the service role, which bypasses RLS).
create policy "qa_feedbacks_self_insert" on public.qa_feedbacks
  for insert with check (auth.uid() = user_id);

-- Super admin reads everything. NOTE: the gate uses the JWT `email` claim
-- rather than `exists (select 1 from auth.users …)` — the `authenticated`
-- role has no SELECT privilege on `auth.users`, so an in-policy subquery
-- against it fails instead of matching. `auth.jwt() ->> 'email'` is the
-- Supabase-supported way to read the caller's email inside a policy.
create policy "qa_feedbacks_super_admin_read" on public.qa_feedbacks
  for select using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );

-- ── Storage bucket (private, 10 MB cap) ──────────────────────────────────
-- Created here so `supabase db push` fully provisions the feature without a
-- manual Dashboard step; idempotent on re-run.
insert into storage.buckets (id, name, public, file_size_limit)
values ('qa-feedback-audio', 'qa-feedback-audio', false, 10485760)
on conflict (id) do nothing;

-- ── Storage RLS (storage.objects) ────────────────────────────────────────
-- A user uploads only under their own {user_id}/ prefix…
create policy "qa_audio_self_upload" on storage.objects
  for insert with check (
    bucket_id = 'qa-feedback-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- …and reads back only their own files (signed URLs also bypass RLS, but
-- this keeps direct authenticated reads scoped correctly too).
create policy "qa_audio_self_read" on storage.objects
  for select using (
    bucket_id = 'qa-feedback-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Super admin reads every object in the bucket (same JWT-claim gate as above).
create policy "qa_audio_super_admin_read" on storage.objects
  for select using (
    bucket_id = 'qa-feedback-audio'
    and (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
