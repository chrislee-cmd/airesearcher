-- Per-user Google OAuth refresh tokens for Forms publishing.
--
-- The recruiting feature lets users push generated surveys directly into
-- a new Google Form. We store only the long-lived refresh_token here and
-- exchange it for a fresh access_token on each publish call. Scope is
-- recorded so that, if we add Drive/Sheets later, we can detect when
-- re-consent is needed.

create table if not exists public.user_google_oauth (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scope text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_google_oauth enable row level security;

drop policy if exists user_google_oauth_self_select on public.user_google_oauth;
create policy user_google_oauth_self_select
  on public.user_google_oauth for select
  using (auth.uid() = user_id);

-- Writes go through the service role only (server-side OAuth callback /
-- forms publishing routes), never directly from the browser.
