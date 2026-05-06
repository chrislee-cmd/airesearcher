-- 0011_trial_fingerprints.sql
--
-- Soft device-fingerprint dedup for the 24h free trial (option D).
--
-- Why: a user can sign up with a fresh email in another browser on the same
-- machine and pick up a fresh trial. Cross-browser stable signals (public
-- IP, screen resolution, timezone, OS, CPU cores, color depth) catch this
-- without false-positives on different machines that happen to share an
-- office /24.
--
-- Policy enforced by `apply_trial_policy`:
--   - exact-hash match exists  → trial_ends_at = now()         (no trial)
--   - same /24 in last 7 days  ≥ 3 distinct hashes
--                              → trial_ends_at = now() + 6h    (shortened)
--   - otherwise                → trial_ends_at = now() + 24h   (full trial)
-- Always returns the org's resulting `trial_ends_at` so the client can
-- update the badge without a separate round-trip.

create table public.trial_fingerprints (
  hash text primary key,
  ip text,
  ip_24 text,                                  -- /24 prefix, e.g. "203.0.113"
  first_org_id uuid references public.organizations(id) on delete set null,
  first_seen_at timestamptz not null default now()
);

create index on public.trial_fingerprints (ip_24, first_seen_at desc);

alter table public.trial_fingerprints enable row level security;
-- No user policies — service role only (called from /api/auth/trial-init).

create or replace function public.apply_trial_policy(
  p_org_id     uuid,
  p_hash       text,
  p_ip         text,
  p_ip_24      text
) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_existing_org uuid;
  v_recent_count int;
  v_new_end timestamptz;
begin
  -- 1. Exact-hash collision → no trial.
  select first_org_id into v_existing_org
    from public.trial_fingerprints where hash = p_hash;

  if v_existing_org is not null and v_existing_org <> p_org_id then
    update public.organizations
       set trial_ends_at = now()
     where id = p_org_id
     returning trial_ends_at into v_new_end;
    return v_new_end;
  end if;

  -- 2. Same /24 with ≥3 distinct hashes in last 7 days → 6h trial.
  if p_ip_24 is not null then
    select count(distinct hash) into v_recent_count
      from public.trial_fingerprints
     where ip_24 = p_ip_24
       and first_seen_at > now() - interval '7 days';
    if v_recent_count >= 3 then
      update public.organizations
         set trial_ends_at = now() + interval '6 hours'
       where id = p_org_id
       returning trial_ends_at into v_new_end;
      -- Still record the new fingerprint so future sign-ups see this one too.
      insert into public.trial_fingerprints (hash, ip, ip_24, first_org_id)
      values (p_hash, p_ip, p_ip_24, p_org_id)
      on conflict (hash) do nothing;
      return v_new_end;
    end if;
  end if;

  -- 3. Default → full 24h trial. Record the fingerprint.
  insert into public.trial_fingerprints (hash, ip, ip_24, first_org_id)
  values (p_hash, p_ip, p_ip_24, p_org_id)
  on conflict (hash) do nothing;

  -- handle_new_user already set trial_ends_at = now() + 24h. Don't overwrite
  -- — just return whatever's there.
  select trial_ends_at into v_new_end
    from public.organizations where id = p_org_id;
  return v_new_end;
end $$;

revoke all on function public.apply_trial_policy(uuid, text, text, text) from public;
revoke all on function public.apply_trial_policy(uuid, text, text, text) from anon, authenticated;
grant  execute on function public.apply_trial_policy(uuid, text, text, text) to service_role;
