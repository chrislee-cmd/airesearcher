-- 20260712040125_payments_is_test_flag.sql
--
-- Adds a generic `is_test` flag to payments so test/non-real charges can be
-- excluded from revenue aggregates WITHOUT deleting or mutating the audit
-- record. Two consumers:
--   - admin/status revenue sum (analytics.ts computeTotals) filters it out
--   - the Lemon Squeezy webhook stamps payload.test_mode onto new orders so
--     future test-mode charges self-classify (no manual marking needed)
--
-- Backfill: the single known test row is a 200,000 KRW bank_transfer marked
-- 'paid' with no matching deposit (bank_reference 'MR-ZVXFHD', 2026-05-06).
-- It is the only thing currently inflating the dashboard revenue figure.

alter table public.payments
  add column if not exists is_test boolean not null default false;

-- Mark the one known test payment (idempotent; scoped tightly so no real
-- charge can be caught). Record is preserved — only the flag flips.
update public.payments
   set is_test = true
 where bank_reference = 'MR-ZVXFHD'
   and status = 'paid'
   and method = 'bank_transfer'
   and amount_krw = 200000;
