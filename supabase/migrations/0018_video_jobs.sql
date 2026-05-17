-- Video Analyzer: durable jobs table for Twelvelabs-backed video analysis.
-- Uses the new v1.3 API: /assets → /indexed-assets → /analyze (Pegasus model).

create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Input
  filename text not null,
  size_bytes bigint,
  storage_key text not null,

  -- Twelvelabs (v1.3 new asset-based API)
  tl_asset_id text,             -- from POST /assets
  tl_indexed_asset_id text,     -- from POST /indexes/{id}/indexed-assets (Location header)
  tl_index_id text not null,    -- analyze index (Pegasus+Marengo)

  -- Pipeline state
  status text not null default 'uploading'
    check (status in ('uploading','indexing','analyzing','done','error')),

  -- Outputs
  analysis text,                -- markdown from /analyze (Pegasus)
  error_message text,
  generation_id uuid references public.generations(id) on delete set null,
  credits_spent int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.video_jobs (org_id, created_at desc);
create index on public.video_jobs (user_id, created_at desc);
create index on public.video_jobs (status);

create or replace function public.touch_video_jobs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_video_jobs on public.video_jobs;
create trigger trg_touch_video_jobs
  before update on public.video_jobs
  for each row execute function public.touch_video_jobs();

alter table public.video_jobs enable row level security;

create policy "vj_select_member" on public.video_jobs
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "vj_insert_member" on public.video_jobs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "vj_update_owner_or_admin" on public.video_jobs
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "vj_delete_owner_or_admin" on public.video_jobs
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
