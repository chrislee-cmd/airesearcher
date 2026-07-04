-- recruiting_invitations — the new "request an invitation" flow that replaces
-- the deprecated credit-gated PII unlock. Respondent contact info is NEVER
-- shown to the requesting user (all masked ****); instead the user matches
-- respondents by criteria and files an invitation request. Each row is one
-- such request. A super admin then looks up the real contacts in
-- /admin/recruiting-invitations and sends the invitations on the user's behalf.
create table if not exists public.recruiting_invitations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  project_id        uuid,            -- recruiting project (optional — may be null)
  form_id           text not null,   -- Google Form id
  response_ids      text[] not null, -- Google Forms responseId list to invite
  status            text not null default 'pending'
                      check (status in ('pending', 'sent', 'declined', 'archived')),
  admin_note        text,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);

create index if not exists recruiting_invitations_requester_idx
  on public.recruiting_invitations (requester_user_id);
create index if not exists recruiting_invitations_form_idx
  on public.recruiting_invitations (form_id);
create index if not exists recruiting_invitations_status_idx
  on public.recruiting_invitations (status);
create index if not exists recruiting_invitations_created_idx
  on public.recruiting_invitations (created_at desc);

alter table public.recruiting_invitations enable row level security;

-- Users may read and file their own requests. The insert path also goes
-- through the API with the user's RLS client, so the with-check keeps a
-- client from forging a request on another user's behalf.
drop policy if exists "invitations_self_select" on public.recruiting_invitations;
create policy "invitations_self_select"
  on public.recruiting_invitations
  for select
  using (auth.uid() = requester_user_id);

drop policy if exists "invitations_self_insert" on public.recruiting_invitations;
create policy "invitations_self_insert"
  on public.recruiting_invitations
  for insert
  with check (auth.uid() = requester_user_id);

-- Super admin (hardcoded email, matched against auth.users) can read every
-- request and update its status. This is a defense-in-depth backstop: the
-- admin GET/PATCH routes additionally gate in code via isSuperAdminEmail and
-- use the service-role client, mirroring the existing /api/admin/* pattern.
drop policy if exists "invitations_super_admin_all" on public.recruiting_invitations;
create policy "invitations_super_admin_all"
  on public.recruiting_invitations
  for all
  using (
    exists (
      select 1 from auth.users
      where auth.users.id = auth.uid()
        and lower(auth.users.email) = 'chris.lee@meteor-research.com'
    )
  );
