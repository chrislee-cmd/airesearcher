-- Transcript generator: jobs table + Supabase Storage bucket for raw uploads.

-- Storage bucket. Private — Deepgram fetches via signed URLs. 5GB cap per file
-- (Supabase free tier object size limit is much lower; pro plan covers 5GB).
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio-uploads', 'audio-uploads', false, 5368709120)
on conflict (id) do nothing;

-- Storage RLS policies — users only see/insert under their own auth.uid() prefix
drop policy if exists "audio_user_insert" on storage.objects;
drop policy if exists "audio_user_select" on storage.objects;
drop policy if exists "audio_user_delete" on storage.objects;

create policy "audio_user_insert" on storage.objects
  for insert with check (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "audio_user_select" on storage.objects
  for select using (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "audio_user_delete" on storage.objects
  for delete using (
    bucket_id = 'audio-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Jobs table — async transcription pipeline state
create table public.transcript_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric,
  speakers_count int,
  status text not null default 'queued'
    check (status in ('queued','submitting','transcribing','done','error')),
  deepgram_request_id text,
  markdown text,
  raw_result jsonb,
  error_message text,
  credits_spent int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.transcript_jobs (org_id, created_at desc);
create index on public.transcript_jobs (user_id, created_at desc);
create index on public.transcript_jobs (deepgram_request_id);

create or replace function public.touch_transcript_jobs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_transcript_jobs on public.transcript_jobs;
create trigger trg_touch_transcript_jobs
  before update on public.transcript_jobs
  for each row execute function public.touch_transcript_jobs();

alter table public.transcript_jobs enable row level security;

create policy "tj_select_member" on public.transcript_jobs
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "tj_insert_member" on public.transcript_jobs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "tj_update_owner_or_admin" on public.transcript_jobs
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "tj_delete_owner_or_admin" on public.transcript_jobs
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- Realtime
alter publication supabase_realtime add table public.transcript_jobs;
