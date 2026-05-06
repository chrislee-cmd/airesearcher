-- Persist Google Forms the user has published from the recruiting feature.
--
-- We need this so the responses panel can render across page refreshes
-- without forcing the user to remember a formId, and so the auto-poll
-- knows which forms belong to which user (no global iteration).

create table if not exists public.recruiting_forms (
  form_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  responder_uri text not null default '',
  edit_uri text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists recruiting_forms_user_idx
  on public.recruiting_forms (user_id, created_at desc);

alter table public.recruiting_forms enable row level security;

drop policy if exists recruiting_forms_self_select on public.recruiting_forms;
create policy recruiting_forms_self_select
  on public.recruiting_forms for select
  using (auth.uid() = user_id);

drop policy if exists recruiting_forms_self_delete on public.recruiting_forms;
create policy recruiting_forms_self_delete
  on public.recruiting_forms for delete
  using (auth.uid() = user_id);

-- Inserts go through the service-role client in /api/recruiting/google/
-- forms/create after a successful Forms API round-trip — never directly
-- from the browser.
