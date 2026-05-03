-- AI Researcher schema: profiles, organizations, members, credits, generations, shares.

create extension if not exists "pgcrypto";

-- ENUMS ------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'member', 'viewer');

-- TABLES -----------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  avatar_url text,
  locale text default 'ko',
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id),
  credit_balance int not null default 0 check (credit_balance >= 0),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  unique (org_id, invited_email),
  check (user_id is not null or invited_email is not null)
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  delta int not null,
  reason text not null,
  feature text,
  generation_id uuid,
  created_at timestamptz not null default now()
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  feature text not null,
  input text,
  output text,
  credits_spent int not null default 0,
  visibility text not null default 'org' check (visibility in ('private', 'org', 'shared')),
  created_at timestamptz not null default now()
);

create table public.generation_shares (
  generation_id uuid references public.generations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  permission text not null default 'view' check (permission in ('view', 'edit')),
  primary key (generation_id, user_id)
);

create index on public.generations (org_id, created_at desc);
create index on public.organization_members (user_id);

-- HELPER FUNCTIONS -------------------------------------------------------
create or replace function public.has_org_role(p_org uuid, p_min text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and case p_min
        when 'viewer' then m.role in ('viewer','member','admin','owner')
        when 'member' then m.role in ('member','admin','owner')
        when 'admin'  then m.role in ('admin','owner')
        when 'owner'  then m.role = 'owner'
        else false end
  )
$$;

create or replace function public.spend_credits(
  p_org_id uuid, p_amount int, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  rows_affected int;
begin
  if not public.has_org_role(p_org_id, 'member') then
    return false;
  end if;

  update public.organizations
     set credit_balance = credit_balance - p_amount
   where id = p_org_id and credit_balance >= p_amount;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then return false; end if;

  insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
  values (p_org_id, auth.uid(), -p_amount, 'feature_use', p_feature, p_generation_id);

  return true;
end $$;

-- RLS --------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.generations enable row level security;
alter table public.generation_shares enable row level security;

create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

create policy "org_member_select" on public.organizations
  for select using (
    exists (select 1 from public.organization_members m
            where m.org_id = id and m.user_id = auth.uid())
  );
create policy "org_owner_update" on public.organizations
  for update using (auth.uid() = owner_id);

create policy "members_select" on public.organization_members
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "members_insert_admin" on public.organization_members
  for insert with check (public.has_org_role(org_id, 'admin'));
create policy "members_update_admin" on public.organization_members
  for update using (public.has_org_role(org_id, 'admin'));
create policy "members_delete_admin" on public.organization_members
  for delete using (public.has_org_role(org_id, 'admin'));

create policy "credits_select_member" on public.credit_transactions
  for select using (public.has_org_role(org_id, 'viewer'));

create policy "gen_select" on public.generations
  for select using (
    user_id = auth.uid()
    or (visibility = 'org' and public.has_org_role(org_id, 'viewer'))
    or exists (select 1 from public.generation_shares s
               where s.generation_id = id and s.user_id = auth.uid())
  );
create policy "gen_insert_member" on public.generations
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy "gen_update_owner_or_admin" on public.generations
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy "gen_delete_owner_or_admin" on public.generations
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

create policy "shares_select" on public.generation_shares
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.generations g
               where g.id = generation_id and g.user_id = auth.uid())
  );
create policy "shares_manage_by_owner" on public.generation_shares
  for all using (
    exists (select 1 from public.generations g
            where g.id = generation_id
              and (g.user_id = auth.uid()
                   or public.has_org_role(g.org_id, 'admin')))
  );

-- AUTO-PROVISION ON SIGNUP ----------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org uuid;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.organizations (name, owner_id, credit_balance)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Workspace'),
          new.id, 10)
  returning id into new_org;

  insert into public.organization_members (org_id, user_id, role)
  values (new_org, new.id, 'owner');

  insert into public.credit_transactions (org_id, user_id, delta, reason)
  values (new_org, new.id, 10, 'signup_grant');

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
