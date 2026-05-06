-- 0009_trial_and_unlimited.sql
--
-- Adds two billing concepts to `organizations`:
--   1. `trial_ends_at`  — trial cutoff = signup time + 24h (so a user who
--      signs up at 22:00 still gets a full day, not just until midnight).
--      Inside the window every feature is free; after it, `spend_credits`
--      enforces the balance check.
--   2. `is_unlimited`   — permanent free pass for ops/super-admin orgs.
--
-- Updates `handle_new_user` so newly-signed-up orgs get
-- `trial_ends_at = now() + 24 hours`, and updates `spend_credits` to short-
-- circuit on either flag while still logging usage to `credit_transactions`
-- (with `delta = 0` and a distinguishing `reason`) so we can audit.
--
-- A new `spend_credits_admin` companion is added for service-role contexts
-- (Deepgram webhook, server-side jobs) that have no `auth.uid()`.

-- ── columns ───────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists trial_ends_at timestamptz,
  add column if not exists is_unlimited  boolean not null default false;

-- Backfill: existing orgs are not on trial. Their `trial_ends_at` stays NULL
-- so the `is null` branch in the RPC treats them as "trial over".
-- (Newly-created orgs after this migration will get a non-null value.)

-- Pin the super-admin org to unlimited. Idempotent: no-op if the row is
-- already flagged or doesn't exist on this database.
update public.organizations
   set is_unlimited = true
 where id = '666ec3eb-9e22-47ed-9917-871b9df788ef'
   and is_unlimited = false;

-- ── trigger: handle_new_user ──────────────────────────────────────────────
-- Trial = 24 hours from signup. Wall-clock alignment (e.g. next KST midnight)
-- would short-change anyone signing up late at night, so we use a fixed
-- duration instead.
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

  insert into public.organizations (name, owner_id, credit_balance, trial_ends_at)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Workspace'),
          new.id, 10, now() + interval '24 hours')
  returning id into new_org;

  insert into public.organization_members (org_id, user_id, role)
  values (new_org, new.id, 'owner');

  insert into public.credit_transactions (org_id, user_id, delta, reason)
  values (new_org, new.id, 10, 'signup_grant');

  return new;
end $$;

-- ── RPC: spend_credits ────────────────────────────────────────────────────
-- Free-pass branches log a delta=0 transaction so we can attribute trial /
-- unlimited usage later without polluting balance arithmetic.
create or replace function public.spend_credits(
  p_org_id uuid, p_amount int, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  rows_affected int;
  v_unlimited   boolean;
  v_trial_end   timestamptz;
begin
  if not public.has_org_role(p_org_id, 'member') then
    return false;
  end if;

  select is_unlimited, trial_ends_at into v_unlimited, v_trial_end
    from public.organizations where id = p_org_id;

  if v_unlimited or (v_trial_end is not null and now() < v_trial_end) then
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (
      p_org_id, auth.uid(), 0,
      case when v_unlimited then 'unlimited_use' else 'trial_use' end,
      p_feature, p_generation_id
    );
    return true;
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

-- ── RPC: spend_credits_admin ──────────────────────────────────────────────
-- Service-role companion. Required by the Deepgram webhook (and any other
-- background job that runs without an `auth.uid()`). Caller must pass the
-- acting user_id so audit trails stay attributable. SECURITY DEFINER, so
-- the function is granted to `service_role` only — never expose to anon.
create or replace function public.spend_credits_admin(
  p_org_id uuid, p_user_id uuid, p_amount int, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  rows_affected int;
  v_unlimited   boolean;
  v_trial_end   timestamptz;
begin
  select is_unlimited, trial_ends_at into v_unlimited, v_trial_end
    from public.organizations where id = p_org_id;
  if not found then return false; end if;

  if v_unlimited or (v_trial_end is not null and now() < v_trial_end) then
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (
      p_org_id, p_user_id, 0,
      case when v_unlimited then 'unlimited_use' else 'trial_use' end,
      p_feature, p_generation_id
    );
    return true;
  end if;

  update public.organizations
     set credit_balance = credit_balance - p_amount
   where id = p_org_id and credit_balance >= p_amount;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then return false; end if;

  insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
  values (p_org_id, p_user_id, -p_amount, 'feature_use', p_feature, p_generation_id);
  return true;
end $$;

revoke all on function public.spend_credits_admin(uuid, uuid, int, text, uuid) from public;
revoke all on function public.spend_credits_admin(uuid, uuid, int, text, uuid) from anon, authenticated;
grant execute on function public.spend_credits_admin(uuid, uuid, int, text, uuid) to service_role;
