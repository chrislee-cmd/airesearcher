-- Generic content-addressed cache. Service role writes only; no RLS exposure.

create table public.cache_entries (
  key text primary key,
  value jsonb not null,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

create index on public.cache_entries (created_at desc);

alter table public.cache_entries enable row level security;
-- Lock the table down — only the service role bypasses RLS by design.
-- (No SELECT/INSERT/UPDATE/DELETE policies = nothing for end users.)
