-- Desk Research: durable jobs table so a search survives navigation/refresh.
-- Mirrors the transcript_jobs pattern (status + RLS + realtime).

create table public.desk_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Inputs
  keywords text[] not null,
  sources text[] not null,
  locale text not null default 'ko',
  date_from text,                       -- 'YYYY-MM-DD'
  date_to text,

  -- Pipeline state
  status text not null default 'queued'
    check (status in ('queued','expanding','crawling','summarizing','done','error')),
  progress jsonb not null default '{}'::jsonb,
  similar_keywords text[] not null default array[]::text[],

  -- Outputs
  output text,
  articles jsonb,
  skipped jsonb,
  error_message text,
  generation_id uuid references public.generations(id) on delete set null,
  credits_spent int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.desk_jobs (org_id, created_at desc);
create index on public.desk_jobs (user_id, created_at desc);
create index on public.desk_jobs (status);

create or replace function public.touch_desk_jobs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_desk_jobs on public.desk_jobs;
create trigger trg_touch_desk_jobs
  before update on public.desk_jobs
  for each row execute function public.touch_desk_jobs();

alter table public.desk_jobs enable row level security;

create policy "dj_select_member" on public.desk_jobs
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "dj_insert_member" on public.desk_jobs
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "dj_update_owner_or_admin" on public.desk_jobs
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "dj_delete_owner_or_admin" on public.desk_jobs
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- Realtime — provider subscribes to row updates so progress lands without polling.
alter publication supabase_realtime add table public.desk_jobs;
