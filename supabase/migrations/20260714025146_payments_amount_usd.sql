-- 20260714025146_payments_amount_usd.sql
--
-- Dual-rail pricing (2026-07-14): 통화가 결제 rail 로 결정된다.
--   · LS 카드 rail  = USD (볼륨할인가) — 이 컬럼에 실 결제 USD 총액을 기록.
--   · 계좌이체 rail = KRW (하나은행 flat) — 기존 amount_krw 를 계속 사용.
--
-- 기존 payments.amount_krw 는 NOT NULL (KRW 전제) 이라 USD 결제 총액을 담을
-- 곳이 없었다. `amount_usd` 를 **additive nullable** 로 추가한다:
--   · USD(LS) 결제 → amount_usd = 팩 USD 총액, amount_krw = 0 (currency='USD' 가
--     권위 통화). 관리자 대사(reconciliation)는 currency 로 rail 을 구분한다.
--   · KRW(계좌이체/legacy) 결제 → amount_krw 그대로, amount_usd = null.
--
-- 순수 additive (add column) — 기존 KRW 이력은 amount_usd = null 로 무손상.
-- 재실행 안전(if not exists). currency 컬럼은 20260629142415_payment_currency 에서
-- 이미 추가됨.

alter table public.payments
  add column if not exists amount_usd numeric(12, 2)
    check (amount_usd is null or amount_usd >= 0);

comment on column public.payments.amount_usd is
  'LS 카드(USD) rail 결제 총액(달러). KRW rail 결제는 null. currency 가 권위 통화.';
