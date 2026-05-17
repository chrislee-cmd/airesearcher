-- 0018_creem_payment.sql
--
-- Adds Creem.io as a card-payment rail alongside the existing Stripe and
-- bank_transfer methods. We extend the method check constraint and add a
-- creem_checkout_id column (mirrors stripe_session_id for Creem sessions).

alter table public.payments
  drop constraint payments_method_check;

alter table public.payments
  add constraint payments_method_check
    check (method in ('stripe', 'creem', 'bank_transfer'));

alter table public.payments
  add column creem_checkout_id text;

create unique index on public.payments (creem_checkout_id)
  where creem_checkout_id is not null;
