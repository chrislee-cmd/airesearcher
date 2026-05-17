-- Fix book_slot RPC: OUT parameter names (booking_id, cancel_token) collided
-- with column names of the same name in scheduler_bookings/_slots, which
-- made plpgsql resolve identifiers to the OUT params and broke the
-- INSERT ... RETURNING ... INTO and UPDATE ... SET booking_id = ...
-- statements at runtime. Rename OUT params and also add an explicit
-- variable_conflict directive for safety.
--
-- The return type changes (renamed OUT params), so we must DROP first;
-- CREATE OR REPLACE cannot change the return row type.

drop function if exists public.book_slot(text, uuid, text, text, text, text, jsonb);

create function public.book_slot(
  p_slug text,
  p_slot_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_custom_fields jsonb
)
returns table (
  out_booking_id uuid,
  out_cancel_token uuid,
  out_slot_date date,
  out_slot_start time,
  out_slot_end time,
  out_link_title text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_link_id uuid;
  v_link_title text;
  v_slot_id uuid;
  v_slot_date date;
  v_slot_start time;
  v_slot_end time;
  v_booking_id uuid;
  v_cancel uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  select l.id, l.title
    into v_link_id, v_link_title
    from public.scheduler_booking_links l
   where l.slug = p_slug
     and l.status = 'active'
     and (l.expires_at is null or l.expires_at > now())
   limit 1;

  if v_link_id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;

  update public.scheduler_booking_slots s
     set status = 'booked', updated_at = now()
   where s.id = p_slot_id
     and s.link_id = v_link_id
     and s.status = 'open'
   returning s.id, s.date, s.start_time, s.end_time
     into v_slot_id, v_slot_date, v_slot_start, v_slot_end;

  if v_slot_id is null then
    raise exception 'slot_unavailable' using errcode = 'P0002';
  end if;

  insert into public.scheduler_bookings as b
    (link_id, slot_id, name, email, phone, note, custom_fields)
  values
    (v_link_id, v_slot_id, trim(p_name), trim(p_email),
     nullif(trim(coalesce(p_phone, '')), ''),
     nullif(trim(coalesce(p_note, '')), ''),
     coalesce(p_custom_fields, '{}'::jsonb))
  returning b.id, b.cancel_token into v_booking_id, v_cancel;

  update public.scheduler_booking_slots s
     set booking_id = v_booking_id
   where s.id = v_slot_id;

  out_booking_id := v_booking_id;
  out_cancel_token := v_cancel;
  out_slot_date := v_slot_date;
  out_slot_start := v_slot_start;
  out_slot_end := v_slot_end;
  out_link_title := v_link_title;
  return next;
end $$;

grant execute on function public.book_slot(text, uuid, text, text, text, text, jsonb) to anon, authenticated;
