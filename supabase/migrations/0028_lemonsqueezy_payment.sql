-- 0028_lemonsqueezy_payment.sql
--
-- Replaces the Creem card-payment rail with Lemon Squeezy (merchant of
-- record). We keep the historical 'creem' value valid in the method check
-- so legacy rows survive, and add lemonsqueezy_checkout_id /
-- lemonsqueezy_order_id columns mirroring the existing creem_checkout_id
-- pattern for traceability + idempotency.

alter table public.payments
  drop constraint payments_method_check;

alter table public.payments
  add constraint payments_method_check
    check (method in ('stripe', 'creem', 'lemonsqueezy', 'bank_transfer'));

alter table public.payments
  add column lemonsqueezy_checkout_id text;

alter table public.payments
  add column lemonsqueezy_order_id text;

create unique index on public.payments (lemonsqueezy_checkout_id)
  where lemonsqueezy_checkout_id is not null;

create unique index on public.payments (lemonsqueezy_order_id)
  where lemonsqueezy_order_id is not null;
