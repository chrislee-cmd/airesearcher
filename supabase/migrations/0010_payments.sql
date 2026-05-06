-- 0010_payments.sql
--
-- Records every credit top-up attempt + the credit grant that follows. Two
-- payment rails:
--   - 'stripe' — automated. Webhook flips status='paid' and grants credits.
--   - 'bank_transfer' — manual. User wires money referencing a generated
--     code; admin confirms in dashboard, which grants credits.
--
-- Tax invoice info (Korean 세금계산서) is captured at checkout time. We
-- store it as jsonb so adding/removing fields doesn't need a schema change.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  bundle_id text not null,
  credits int not null check (credits > 0),
  amount_krw int not null check (amount_krw >= 0),
  method text not null check (method in ('stripe', 'bank_transfer')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  -- Stripe-only
  stripe_session_id text,
  stripe_payment_intent_id text,
  -- Bank-transfer-only. Auto-generated short code shown to the user as the
  -- "입금자명" so an admin can match a deposit to a payment row.
  bank_reference text,
  -- Tax invoice (세금계산서) request. Null when the box is left unchecked.
  tax_invoice jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz
);

create index on public.payments (org_id, created_at desc);
create index on public.payments (status, method);
create unique index on public.payments (stripe_session_id)
  where stripe_session_id is not null;
create unique index on public.payments (bank_reference)
  where bank_reference is not null;

-- Audit row written when a payment.status flips to 'paid'. One-to-one in
-- practice, but kept separate so a refund can stamp a balancing row later.
create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  credits int not null,
  granted_at timestamptz not null default now()
);

alter table public.payments enable row level security;
alter table public.credit_grants enable row level security;

-- RLS: org members can read their own payments. Inserts/updates happen via
-- the service-role key from API routes (RPC below or admin client), so we
-- don't grant write policies to authenticated users.
create policy "payments_member_select" on public.payments
  for select using (public.has_org_role(org_id, 'viewer'));
create policy "credit_grants_member_select" on public.credit_grants
  for select using (public.has_org_role(org_id, 'viewer'));

-- ── RPC: grant_credits_from_payment ──────────────────────────────────────
-- Called when payment is confirmed (Stripe webhook OR admin manual confirm).
-- Atomic: flips status to 'paid', tops up the org balance, writes the
-- credit_grants and credit_transactions audit rows. Idempotent — calling
-- twice on the same payment_id is a no-op after the first success.
create or replace function public.grant_credits_from_payment(
  p_payment_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
  v_credits int;
  v_status text;
begin
  select org_id, user_id, credits, status
    into v_org_id, v_user_id, v_credits, v_status
    from public.payments where id = p_payment_id for update;
  if not found then return false; end if;
  if v_status = 'paid' then return true; end if;  -- already done
  if v_status not in ('pending') then return false; end if;

  update public.organizations
     set credit_balance = credit_balance + v_credits
   where id = v_org_id;

  insert into public.credit_grants (payment_id, org_id, credits)
  values (p_payment_id, v_org_id, v_credits);

  insert into public.credit_transactions (org_id, user_id, delta, reason, feature)
  values (v_org_id, v_user_id, v_credits, 'topup', null);

  update public.payments
     set status = 'paid', paid_at = now()
   where id = p_payment_id;

  return true;
end $$;

revoke all on function public.grant_credits_from_payment(uuid) from public;
revoke all on function public.grant_credits_from_payment(uuid) from anon, authenticated;
grant execute on function public.grant_credits_from_payment(uuid) to service_role;
