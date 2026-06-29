-- 20260629142415_payment_currency.sql
--
-- Dual-payout groundwork. Lemon Squeezy can route a checkout to one of two
-- stores (KRW domestic / USD foreign), each with its own payout account.
-- The webhook lands on the same endpoint but the originating store_id tells
-- us which payout rail (and currency) the charge belonged to.
--
-- `currency` stamps which rail the user actually paid through so admin
-- reconciliation can sum payouts per account. Existing rows pre-date the
-- split — backfill them to 'KRW' since the legacy single store was payed
-- out to the KRW account.
--
-- `lemonsqueezy_store_id` records the originating store for audit/idempotency
-- without forcing us to derive it back from env at read time.

alter table public.payments
  add column currency text not null default 'KRW'
    check (currency in ('KRW', 'USD'));

alter table public.payments
  add column lemonsqueezy_store_id text;

create index on public.payments (currency, created_at desc);
