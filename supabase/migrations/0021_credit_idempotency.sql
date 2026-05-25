-- 0021_credit_idempotency.sql
--
-- Hardens the credit ledger so server routes can safely:
--   • retry a charge for the same generation without double-billing
--   • refund a charge when downstream work fails
--   • re-issue a refund on retry without doubling the credit
--
-- Adds:
--   1. Partial UNIQUE on `credit_transactions(generation_id) WHERE reason='feature_use'`
--      — at most one paid charge per generation, enforced at the DB.
--   2. Partial UNIQUE on `credit_transactions(generation_id) WHERE reason='feature_refund'`
--      — at most one refund per generation, enforced at the DB.
--   3. `spend_credits` / `spend_credits_admin`: short-circuit on existing
--      charge for the same `generation_id` (any of feature_use / trial_use /
--      unlimited_use). On a concurrent INSERT race, undo the balance
--      decrement so the unique winner stands alone.
--   4. `credit_refund(p_org_id, p_user_id, p_feature, p_generation_id)`:
--      reverses the original `feature_use` row for a generation by looking
--      up the actual charged amount in the ledger (so caller intent and
--      ledger truth can never disagree). Idempotent: a second call returns
--      true without re-crediting. Trial / unlimited rows (delta=0) are
--      "refunded" as a delta=0 audit row — nothing to restore.
--      Service-role only.
--
-- NULL `generation_id` (legacy background charges with no gen row, e.g.
-- pre-2024 audit entries) is ignored by both partial indexes — those flows
-- keep working as-is.

-- ── partial UNIQUE indexes ────────────────────────────────────────────────
create unique index if not exists credit_transactions_charge_uniq
  on public.credit_transactions (generation_id)
  where reason = 'feature_use' and generation_id is not null;

create unique index if not exists credit_transactions_refund_uniq
  on public.credit_transactions (generation_id)
  where reason = 'feature_refund' and generation_id is not null;

-- ── RPC: spend_credits (idempotent) ───────────────────────────────────────
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

  -- Idempotency: any prior usage row for this generation_id is conclusive.
  -- (feature_use = paid, trial_use / unlimited_use = audit-only delta=0).
  -- A refund row alone does NOT re-open the slot; once refunded, the
  -- generation_id is considered closed.
  if p_generation_id is not null and exists (
    select 1 from public.credit_transactions
     where generation_id = p_generation_id
       and reason in ('feature_use', 'trial_use', 'unlimited_use')
  ) then
    return true;
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

  begin
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, auth.uid(), -p_amount, 'feature_use', p_feature, p_generation_id);
  exception when unique_violation then
    -- Concurrent caller charged first. Reverse our decrement so the unique
    -- winner is the only effective charge.
    update public.organizations set credit_balance = credit_balance + p_amount where id = p_org_id;
    return true;
  end;

  return true;
end $$;

-- ── RPC: spend_credits_admin (idempotent) ─────────────────────────────────
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
  if p_generation_id is not null and exists (
    select 1 from public.credit_transactions
     where generation_id = p_generation_id
       and reason in ('feature_use', 'trial_use', 'unlimited_use')
  ) then
    return true;
  end if;

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

  begin
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, p_user_id, -p_amount, 'feature_use', p_feature, p_generation_id);
  exception when unique_violation then
    update public.organizations set credit_balance = credit_balance - (-p_amount) where id = p_org_id;
    -- ^ note: subtracting a negative = adding |p_amount| back
    return true;
  end;

  return true;
end $$;

-- ── RPC: credit_refund ────────────────────────────────────────────────────
-- Reverses the prior feature_use charge for `p_generation_id`. The refund
-- amount is read from the ledger (not from a caller-supplied value), so
-- intent and ledger truth cannot diverge.
--
-- Returns true on success OR if a refund row already exists (idempotent).
-- Returns false if no original charge can be found for this generation_id
-- under p_org_id (caller passed wrong org / generation).
create or replace function public.credit_refund(
  p_org_id uuid, p_user_id uuid, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_orig_delta int;
  v_orig_reason text;
begin
  if p_generation_id is null then return false; end if;

  -- Already refunded? Idempotent return.
  if exists (
    select 1 from public.credit_transactions
     where generation_id = p_generation_id and reason = 'feature_refund'
  ) then
    return true;
  end if;

  -- Look up the original usage row. Match on org_id so we never refund
  -- across orgs.
  select delta, reason into v_orig_delta, v_orig_reason
    from public.credit_transactions
   where generation_id = p_generation_id
     and org_id = p_org_id
     and reason in ('feature_use', 'trial_use', 'unlimited_use')
   limit 1;

  if v_orig_delta is null then
    -- No matching charge — caller error.
    return false;
  end if;

  -- Trial / unlimited rows have delta=0; no balance to restore but still
  -- write a refund row for audit + idempotency.
  if v_orig_reason in ('trial_use', 'unlimited_use') then
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, p_user_id, 0, 'feature_refund', p_feature, p_generation_id);
    return true;
  end if;

  -- Paid charge — restore the credits.
  update public.organizations
     set credit_balance = credit_balance + (-v_orig_delta)
   where id = p_org_id;

  begin
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, p_user_id, -v_orig_delta, 'feature_refund', p_feature, p_generation_id);
  exception when unique_violation then
    -- Concurrent refund won. Reverse our balance restore so only one effective refund.
    update public.organizations set credit_balance = credit_balance - (-v_orig_delta) where id = p_org_id;
    return true;
  end;

  return true;
end $$;

revoke all on function public.credit_refund(uuid, uuid, text, uuid) from public;
revoke all on function public.credit_refund(uuid, uuid, text, uuid) from anon, authenticated;
grant execute on function public.credit_refund(uuid, uuid, text, uuid) to service_role;
