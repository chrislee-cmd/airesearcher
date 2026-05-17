-- Per-user Notion OAuth tokens for the share-to-Notion feature.
-- Notion issues long-lived access_tokens (no refresh cycle).

create table if not exists public.user_notion_oauth (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  workspace_id text not null,
  workspace_name text,
  bot_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_notion_oauth enable row level security;

create policy notion_oauth_self_select
  on public.user_notion_oauth for select
  using (auth.uid() = user_id);
-- Writes go through service role only (OAuth callback route).
