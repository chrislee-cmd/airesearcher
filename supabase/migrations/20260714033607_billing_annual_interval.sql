-- 20260714033607_billing_annual_interval.sql
--
-- 연간 구독 (USD, 1개월 무료) — organizations 에 결제 주기 컬럼 1개 (additive).
--
--   subscription_interval  text  — 'month' | 'year' (null = 무구독/미상).
--
-- 왜 필요한가: 연간 구독의 갱신(1년 후) 시점의 webhook 은 초기 checkout 의
-- custom_data(interval) 를 못 받을 수 있고, 연간 variant env 가 아직 등록 전이면
-- variant→interval 역매핑도 실패할 수 있다. 그 경우 월간(20cr)으로 오지급되는
-- 것을 막기 위해, subscription_created 시점에 확정된 interval 을 org 에 durable
-- 하게 박아 두고, payment_success 는 custom_data → variant-map → **이 컬럼** →
-- 'month' 순으로 해석한다(가장 보수적 폴백 체인).
--
-- 기존 billing_subscriptions(20260713154738) 의 지급 원장·멱등 게이트는 그대로
-- 재사용한다 — 연간은 credits 값(연 포함크레딧)과 이 interval 컬럼만 다르고,
-- subscription_grants(ls_subscription_id, period) 유니크가 중복 webhook 을
-- 동일하게 흡수한다(period=renews_at 날짜, 연 단위라도 주기마다 distinct).
--
-- 전부 additive(add column if not exists) → 머지 시 자동 적용(PROJECT.md §7.5)
-- 안전 게이트 통과.

alter table public.organizations
  add column if not exists subscription_interval text;
