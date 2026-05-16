-- Scheduler public booking links — Calendly-style flow.
--
-- Owner creates available slots in the in-app scheduler canvas, then mints a
-- booking link with a public slug. Anonymous attendees open the link, pick
-- one of the open slots, submit name + email, and that slot atomically
-- transitions to 'booked' so nobody else can claim it.
--
-- Three tables:
--   scheduler_booking_links — the public-facing landing page (1 row per link)
--   scheduler_booking_slots — fan-out of available slots, each transitions
--                             open → booked exactly once
--   scheduler_bookings      — attendee submissions
--
-- RLS:
--   Owner (org member) can manage their own links.
--   Anonymous role can SELECT a link by slug + open/booked slots, and INSERT
--   bookings only against an existing open slot of an active link. The atomic
--   open→booked transition is guarded by a SECURITY DEFINER RPC that the
--   API route calls — anon UPDATE on slots is denied.

------------------------------------------------------------------------
-- 1) scheduler_booking_links
------------------------------------------------------------------------

create table if not exists public.scheduler_booking_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.scheduler_sessions(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,

  slug text not null unique,
  title text not null default '',
  description text not null default '',
  -- requirement snapshot at creation time so editing the canvas later
  -- doesn't break already-shared links
  requirement jsonb not null default '{}'::jsonb,
  timezone text not null default 'Asia/Seoul',

  status text not null default 'active' check (status in ('active','closed')),
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduler_booking_links_org_idx
  on public.scheduler_booking_links (org_id, created_at desc);
create index if not exists scheduler_booking_links_user_idx
  on public.scheduler_booking_links (user_id, created_at desc);
create index if not exists scheduler_booking_links_slug_idx
  on public.scheduler_booking_links (slug);

create or replace function public.touch_scheduler_booking_links()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_scheduler_booking_links
  on public.scheduler_booking_links;
create trigger trg_touch_scheduler_booking_links
  before update on public.scheduler_booking_links
  for each row execute function public.touch_scheduler_booking_links();

alter table public.scheduler_booking_links enable row level security;

create policy sbl_select_member on public.scheduler_booking_links
  for select using (public.has_org_role(org_id, 'viewer'));
create policy sbl_insert_member on public.scheduler_booking_links
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );
create policy sbl_update_owner_or_admin on public.scheduler_booking_links
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );
create policy sbl_delete_owner_or_admin on public.scheduler_booking_links
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- Anonymous public read by slug. Only active, non-expired links are visible.
create policy sbl_public_select_by_slug on public.scheduler_booking_links
  for select using (
    status = 'active'
    and (expires_at is null or expires_at > now())
  );

------------------------------------------------------------------------
-- 2) scheduler_booking_slots
------------------------------------------------------------------------

create table if not exists public.scheduler_booking_slots (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.scheduler_booking_links(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'open' check (status in ('open','booked')),
  booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, date, start_time)
);

create index if not exists scheduler_booking_slots_link_idx
  on public.scheduler_booking_slots (link_id, date, start_time);

alter table public.scheduler_booking_slots enable row level security;

-- Owner-side policies (org members only).
create policy sbs_select_member on public.scheduler_booking_slots
  for select using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id and public.has_org_role(l.org_id, 'viewer')
    )
  );
create policy sbs_insert_member on public.scheduler_booking_slots
  for insert with check (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id
        and l.user_id = auth.uid()
        and public.has_org_role(l.org_id, 'member')
    )
  );
create policy sbs_update_owner on public.scheduler_booking_slots
  for update using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id
        and (l.user_id = auth.uid() or public.has_org_role(l.org_id, 'admin'))
    )
  );
create policy sbs_delete_owner on public.scheduler_booking_slots
  for delete using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id
        and (l.user_id = auth.uid() or public.has_org_role(l.org_id, 'admin'))
    )
  );

-- Anonymous public read of slots whose link is active. Used to render the
-- public booking page.
create policy sbs_public_select on public.scheduler_booking_slots
  for select using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id
        and l.status = 'active'
        and (l.expires_at is null or l.expires_at > now())
    )
  );

------------------------------------------------------------------------
-- 3) scheduler_bookings
------------------------------------------------------------------------

create table if not exists public.scheduler_bookings (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.scheduler_booking_links(id) on delete cascade,
  slot_id uuid not null references public.scheduler_booking_slots(id) on delete cascade,

  name text not null,
  email text not null,
  phone text,
  note text,
  custom_fields jsonb not null default '{}'::jsonb,

  -- token the attendee can use later for self-service cancellation; not
  -- exposed by default RLS, only returned in the API response on creation
  cancel_token uuid not null default gen_random_uuid(),

  created_at timestamptz not null default now()
);

create index if not exists scheduler_bookings_link_idx
  on public.scheduler_bookings (link_id, created_at desc);
create unique index if not exists scheduler_bookings_slot_uniq
  on public.scheduler_bookings (slot_id);

alter table public.scheduler_bookings enable row level security;

-- Owner-side: org members can see bookings for their links.
create policy sb_select_member on public.scheduler_bookings
  for select using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id and public.has_org_role(l.org_id, 'viewer')
    )
  );
create policy sb_delete_owner on public.scheduler_bookings
  for delete using (
    exists (
      select 1 from public.scheduler_booking_links l
      where l.id = link_id
        and (l.user_id = auth.uid() or public.has_org_role(l.org_id, 'admin'))
    )
  );

-- No anon SELECT/INSERT/UPDATE policy on bookings: PII stays private.
-- Inserts from the public flow happen via SECURITY DEFINER RPC below.

------------------------------------------------------------------------
-- 4) book_slot RPC — atomic claim of an open slot + booking insert
------------------------------------------------------------------------
-- Designed to be safe to call as anon. It re-checks link status, slot
-- status, and atomically transitions the slot to 'booked' in one UPDATE
-- with WHERE status = 'open'. If the UPDATE returns 0 rows the slot was
-- already taken and we raise.

create or replace function public.book_slot(
  p_slug text,
  p_slot_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_custom_fields jsonb
)
returns table (
  booking_id uuid,
  cancel_token uuid,
  slot_date date,
  slot_start time,
  slot_end time,
  link_title text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_slot record;
  v_booking_id uuid;
  v_cancel uuid;
begin
  -- Validate inputs
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Find the link
  select * into v_link
    from public.scheduler_booking_links
   where slug = p_slug
     and status = 'active'
     and (expires_at is null or expires_at > now())
   limit 1;

  if v_link.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;

  -- Lock the slot row, then atomically claim it
  update public.scheduler_booking_slots
     set status = 'booked', updated_at = now()
   where id = p_slot_id
     and link_id = v_link.id
     and status = 'open'
   returning id, date, start_time, end_time into v_slot;

  if v_slot.id is null then
    raise exception 'slot_unavailable' using errcode = 'P0002';
  end if;

  insert into public.scheduler_bookings
    (link_id, slot_id, name, email, phone, note, custom_fields)
  values
    (v_link.id, v_slot.id, trim(p_name), trim(p_email),
     nullif(trim(coalesce(p_phone, '')), ''),
     nullif(trim(coalesce(p_note, '')), ''),
     coalesce(p_custom_fields, '{}'::jsonb))
  returning id, cancel_token into v_booking_id, v_cancel;

  update public.scheduler_booking_slots
     set booking_id = v_booking_id
   where id = v_slot.id;

  return query select
    v_booking_id, v_cancel, v_slot.date, v_slot.start_time, v_slot.end_time,
    v_link.title;
end $$;

grant execute on function public.book_slot(text, uuid, text, text, text, text, jsonb) to anon, authenticated;

-- Public-facing helper that returns just the link metadata + open slot
-- list. Going through an RPC avoids exposing the full link row schema.
create or replace function public.get_booking_link(p_slug text)
returns table (
  id uuid,
  slug text,
  title text,
  description text,
  timezone text,
  expires_at timestamptz,
  slot_id uuid,
  slot_date date,
  slot_start time,
  slot_end time,
  slot_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    l.id, l.slug, l.title, l.description, l.timezone, l.expires_at,
    s.id, s.date, s.start_time, s.end_time, s.status
  from public.scheduler_booking_links l
  left join public.scheduler_booking_slots s on s.link_id = l.id
  where l.slug = p_slug
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at > now())
  order by s.date, s.start_time;
$$;

grant execute on function public.get_booking_link(text) to anon, authenticated;

alter publication supabase_realtime add table public.scheduler_booking_slots;
alter publication supabase_realtime add table public.scheduler_bookings;
