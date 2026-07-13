-- 20260713154738_billing_subscriptions.sql
--
-- Phase 2 (docs/pricing-scheme.md §5.3) — 월 구독 백엔드 (Lemon Squeezy
-- recurring). 크레딧 위에 얹는 MRR 레이어. 포함 크레딧도 ₩500/cr 환산 —
-- 할인이 아니라 편의(무만료·우선처리·시트)가 구독의 가치다(§3.3 불변식).
--
-- 이 마이그가 세우는 것:
--   1. organizations 에 구독 상태 컬럼 4개 (additive)
--        subscription_tier    text        — 'solo' | 'plus' | 'pro' (null = 무구독)
--        subscription_status  text        — LS 상태 그대로 ('active'|'cancelled'|'expired'|'past_due'|...)
--        ls_subscription_id   text        — Lemon Squeezy 구독 id (webhook 상관용)
--        current_period_end   timestamptz — 현 결제주기 종료(=다음 갱신) 시각
--   2. subscription_grants — 지급 원장 겸 멱등 게이트.
--        unique (ls_subscription_id, period) 로 "billing period 당 1회" 강제.
--        같은 구독의 같은 주기에 대한 중복 webhook(재전송·초기결제 이중발화)은
--        여기서 no-op 로 흡수된다.
--   3. grant_subscription_credits(...) RPC — 멱등 지급.
--        grant_credits_from_payment(0010) 패턴 재사용: 원장 insert 성공(=이 주기
--        최초) 일 때만 credit_balance 를 올리고 credit_transactions(reason=
--        'subscription') 감사행을 남긴다.
--
-- ── 크레딧 만료/롤오버 정책 확정 (docs/pricing-scheme.md §5.3 이 PR 에서 결정) ──
--   구독 포함 크레딧은 **무만료** — 만료되는 grant 버킷(grant_credits)이 아니라
--   비만료 credit_balance 로 지급한다. 근거: §5.3 "구독의 가치 = 크레딧 무만료".
--   취소/만료 시에도 이미 지급된 크레딧은 회수하지 않는다(상태만 해제). 가장
--   보수적·단순하며 기존 grant_credits_from_payment(=credit_balance 적립) 패턴과
--   동일. 무료 grant(월 만료, 20260713052131)와는 버킷이 분리돼 서로 간섭 없음.
--
-- 전부 additive(add column / create table if not exists / create or replace) +
-- idempotent → 머지 시 자동 적용(PROJECT.md §7.5) 안전 게이트를 통과한다.

-- ── 1. organizations 구독 상태 컬럼 ──────────────────────────────────────────
alter table public.organizations
  add column if not exists subscription_tier   text,
  add column if not exists subscription_status text,
  add column if not exists ls_subscription_id  text,
  add column if not exists current_period_end  timestamptz;

-- 한 org 는 한 활성 구독만 — 같은 LS 구독 id 가 두 org 에 붙지 않게.
create unique index if not exists organizations_ls_subscription_id_key
  on public.organizations (ls_subscription_id)
  where ls_subscription_id is not null;

-- ── 2. subscription_grants 원장 (멱등 게이트) ────────────────────────────────
create table if not exists public.subscription_grants (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  ls_subscription_id  text not null,
  -- 결제주기 키. 주기-종료일(renews_at 의 date 부분, 'YYYY-MM-DD'). 월 단위라
  -- 날짜 수준 유니크로 충분하며, webhook payload(created) 와 API 조회(payment)
  -- 사이의 초·밀리초 포맷 드리프트를 흡수한다.
  period              text not null,
  tier                text not null,
  credits             int  not null check (credits > 0),
  granted_at          timestamptz not null default now(),
  unique (ls_subscription_id, period)
);

create index if not exists subscription_grants_org_idx
  on public.subscription_grants (org_id, granted_at desc);

alter table public.subscription_grants enable row level security;

-- org 멤버는 자기 조직 구독 지급 이력을 읽을 수 있다. 쓰기는 service_role(RPC)만.
drop policy if exists "subscription_grants_member_select" on public.subscription_grants;
create policy "subscription_grants_member_select" on public.subscription_grants
  for select using (public.has_org_role(org_id, 'viewer'));

-- ── 3. grant_subscription_credits RPC (멱등) ─────────────────────────────────
-- 이 (구독, 주기) 조합에 대한 최초 호출일 때만 지급한다. subscription_grants 의
-- unique(ls_subscription_id, period) 가 게이트: insert 가 실제로 행을 만들면
-- (=최초) credit_balance 를 올리고 감사행을 남기고 true, 이미 있으면(=중복
-- webhook) 아무 것도 안 하고 false 를 돌려준다. credits 는 서버(SUBSCRIPTION_TIERS
-- SSOT)가 계산해 넘긴다 — webhook payload 의 금액을 신뢰하지 않는다.
create or replace function public.grant_subscription_credits(
  p_org_id  uuid,
  p_sub_id  text,
  p_period  text,
  p_tier    text,
  p_credits int
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_owner   uuid;
  v_new_row boolean := false;
begin
  if p_credits is null or p_credits <= 0 then
    return false;
  end if;

  -- 멱등 게이트: 이 주기 최초일 때만 원장 행이 생긴다.
  insert into public.subscription_grants (org_id, ls_subscription_id, period, tier, credits)
  values (p_org_id, p_sub_id, p_period, p_tier, p_credits)
  on conflict (ls_subscription_id, period) do nothing;
  get diagnostics v_new_row = row_count;
  if v_new_row = 0 then
    return false;  -- 이 주기 이미 지급 (중복 webhook) — no-op
  end if;

  -- 무만료 버킷(credit_balance)에 적립. owner_id 를 감사행 user_id 로 사용.
  select owner_id into v_owner from public.organizations where id = p_org_id for update;
  if not found then
    -- 원장은 이미 잠갔지만 org 가 없으면 지급 불가 — 트랜잭션 롤백으로 원장도 취소.
    raise exception 'grant_subscription_credits: org % not found', p_org_id;
  end if;

  update public.organizations
     set credit_balance = credit_balance + p_credits
   where id = p_org_id;

  insert into public.credit_transactions (org_id, user_id, delta, reason, feature)
  values (p_org_id, v_owner, p_credits, 'subscription', null);

  return true;
end $$;

revoke all on function public.grant_subscription_credits(uuid, text, text, text, int) from public;
revoke all on function public.grant_subscription_credits(uuid, text, text, text, int) from anon, authenticated;
grant execute on function public.grant_subscription_credits(uuid, text, text, text, int) to service_role;
