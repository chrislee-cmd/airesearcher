-- 20260713052131_free_monthly_grant_expiring_bucket.sql
--
-- Phase 2 (docs/pricing-scheme.md §5.4) — 무료 월 크레딧 grant (획득용).
--
-- 현행 `organizations.credit_balance` 는 단일 **비만료** int 하나뿐이라, 월
-- 만료되는 grant 를 섞을 수 없다. 여기서 **분리된 만료 버킷**을 도입한다:
--
--   • grant_credits      int          — 만료되는 무료 grant 잔액 (default 0)
--   • grant_expires_at   timestamptz  — 그 버킷의 만료 시각 (월말 = 다음달 1일 0시)
--
-- 소진 순서는 **만료 버킷 우선 → 비만료 credit_balance**. 만료가 지난 grant 는
-- 어디서든 0 으로 취급(레이지 만료 — 별도 청소 cron 불필요). 이 만료 인프라는
-- 진입tier 만료·프로모션 grant 에도 재사용된다.
--
-- 추가 RPC:
--   1. spend_credits / spend_credits_admin  — 만료-버킷-우선 차감으로 확장
--      (기존 멱등성·trial·unlimited 로직은 그대로 보존).
--   2. issue_monthly_grant(p_org_id)         — 한 org 에 이달 25cr 지급, 월 1회 멱등.
--   3. issue_monthly_grants()                — 전 활성 org 벌크 지급(cron 용), 멱등.
--   4. handle_new_user()                     — 신규 org 프로비저닝 시 grant 시딩.
--
-- 지급 대상(정책): `is_unlimited=false` 인 전 활성 org. 스펙은 "전체 무료 or
-- 구독無 org만(여기서 확정)" 이라 했으나 구독 백엔드(B1)가 아직 미머지 →
-- 구독 상태 컬럼이 없어 필터 불가. 가장 보수적으로 ops/super-admin(무제한)
-- org 만 제외한 전 org 로 확정. B1 머지 후 필터를 조일 수 있다.
--
-- 멱등성: 같은 달에 이미 reason='free_grant' 원장 row 가 있으면 재지급 no-op
-- (월 1회). grant 는 **세팅(=25)** 이지 누적이 아니다 → 이월 없음(§5.4).
--
-- 모두 additive(add column / create or replace) + idempotent(if not exists) 라
-- 머지 시 자동 적용(PROJECT.md §7.5) 안전 게이트를 통과한다.

-- ── 1. 만료 버킷 컬럼 ─────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists grant_credits    int not null default 0 check (grant_credits >= 0),
  add column if not exists grant_expires_at timestamptz;

-- ── 2. spend_credits (만료-버킷-우선 차감) ────────────────────────────────
-- 기존 0021 정의를 확장. 변경점: paid 차감 단계에서 유효 grant 를 먼저 소진한
-- 뒤 부족분만 credit_balance 에서 뺀다. 만료 지난 grant 는 유효분 0.
create or replace function public.spend_credits(
  p_org_id uuid, p_amount int, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  rows_affected int;
  v_unlimited   boolean;
  v_trial_end   timestamptz;
  v_grant       int;
  v_grant_exp   timestamptz;
  v_bal         int;
  v_eff_grant   int;
  v_from_grant  int;
  v_from_bal    int;
begin
  if not public.has_org_role(p_org_id, 'member') then
    return false;
  end if;

  -- Idempotency: any prior usage row for this generation_id is conclusive.
  if p_generation_id is not null and exists (
    select 1 from public.credit_transactions
     where generation_id = p_generation_id
       and reason in ('feature_use', 'trial_use', 'unlimited_use')
  ) then
    return true;
  end if;

  -- Lock the org row so the grant/balance split reads and writes are atomic.
  select is_unlimited, trial_ends_at, grant_credits, grant_expires_at, credit_balance
    into v_unlimited, v_trial_end, v_grant, v_grant_exp, v_bal
    from public.organizations where id = p_org_id for update;
  if not found then return false; end if;

  if v_unlimited or (v_trial_end is not null and now() < v_trial_end) then
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (
      p_org_id, auth.uid(), 0,
      case when v_unlimited then 'unlimited_use' else 'trial_use' end,
      p_feature, p_generation_id
    );
    return true;
  end if;

  -- 유효 grant = 만료 안 지난 경우에만. 만료-버킷 우선, 나머지는 credit_balance.
  v_eff_grant  := case when v_grant_exp is not null and now() < v_grant_exp then v_grant else 0 end;
  v_from_grant := least(v_eff_grant, p_amount);
  v_from_bal   := p_amount - v_from_grant;

  update public.organizations
     set grant_credits  = grant_credits - v_from_grant,
         credit_balance = credit_balance - v_from_bal
   where id = p_org_id and credit_balance >= v_from_bal;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then return false; end if;

  begin
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, auth.uid(), -p_amount, 'feature_use', p_feature, p_generation_id);
  exception when unique_violation then
    -- Concurrent caller charged first. Reverse both decrements so the unique
    -- winner is the only effective charge.
    update public.organizations
       set grant_credits  = grant_credits + v_from_grant,
           credit_balance = credit_balance + v_from_bal
     where id = p_org_id;
    return true;
  end;

  return true;
end $$;

-- ── 3. spend_credits_admin (만료-버킷-우선 차감) ──────────────────────────
create or replace function public.spend_credits_admin(
  p_org_id uuid, p_user_id uuid, p_amount int, p_feature text, p_generation_id uuid
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  rows_affected int;
  v_unlimited   boolean;
  v_trial_end   timestamptz;
  v_grant       int;
  v_grant_exp   timestamptz;
  v_bal         int;
  v_eff_grant   int;
  v_from_grant  int;
  v_from_bal    int;
begin
  if p_generation_id is not null and exists (
    select 1 from public.credit_transactions
     where generation_id = p_generation_id
       and reason in ('feature_use', 'trial_use', 'unlimited_use')
  ) then
    return true;
  end if;

  select is_unlimited, trial_ends_at, grant_credits, grant_expires_at, credit_balance
    into v_unlimited, v_trial_end, v_grant, v_grant_exp, v_bal
    from public.organizations where id = p_org_id for update;
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

  v_eff_grant  := case when v_grant_exp is not null and now() < v_grant_exp then v_grant else 0 end;
  v_from_grant := least(v_eff_grant, p_amount);
  v_from_bal   := p_amount - v_from_grant;

  update public.organizations
     set grant_credits  = grant_credits - v_from_grant,
         credit_balance = credit_balance - v_from_bal
   where id = p_org_id and credit_balance >= v_from_bal;
  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then return false; end if;

  begin
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature, generation_id)
    values (p_org_id, p_user_id, -p_amount, 'feature_use', p_feature, p_generation_id);
  exception when unique_violation then
    update public.organizations
       set grant_credits  = grant_credits + v_from_grant,
           credit_balance = credit_balance + v_from_bal
     where id = p_org_id;
    return true;
  end;

  return true;
end $$;

-- ── 4. issue_monthly_grant(p_org_id) — 단건 멱등 지급 ─────────────────────
-- 이달 미지급 org 에 25cr 세팅(grant_credits=25, grant_expires_at=월말), 월 1회
-- 멱등. reason='free_grant' 원장 기록. lazy on-login 경로에서도 재사용 가능.
-- 반환: true=지급함, false=대상아님(무제한/부재) 또는 이달 이미 지급.
create or replace function public.issue_monthly_grant(p_org_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_owner     uuid;
  v_unlimited boolean;
  v_expires   timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  select owner_id, is_unlimited into v_owner, v_unlimited
    from public.organizations where id = p_org_id for update;
  if not found then return false; end if;
  if v_unlimited then return false; end if;

  if exists (
    select 1 from public.credit_transactions
     where org_id = p_org_id and reason = 'free_grant'
       and created_at >= date_trunc('month', now())
  ) then
    return false;  -- 이달 이미 지급 (멱등)
  end if;

  update public.organizations
     set grant_credits = 25, grant_expires_at = v_expires
   where id = p_org_id;

  insert into public.credit_transactions (org_id, user_id, delta, reason, feature)
  values (p_org_id, v_owner, 25, 'free_grant', null);

  return true;
end $$;

-- ── 5. issue_monthly_grants() — 전 활성 org 벌크 지급 (cron) ───────────────
-- 세트 기반 단일 실행. 이달 미지급 + 무제한아님 org 만 대상. 반환 = 지급 건수.
create or replace function public.issue_monthly_grants()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count   int;
  v_expires timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  with eligible as (
    select o.id, o.owner_id
      from public.organizations o
     where o.is_unlimited = false
       and not exists (
         select 1 from public.credit_transactions t
          where t.org_id = o.id and t.reason = 'free_grant'
            and t.created_at >= date_trunc('month', now())
       )
  ), updated as (
    update public.organizations o
       set grant_credits = 25, grant_expires_at = v_expires
      from eligible e
     where o.id = e.id
    returning o.id, e.owner_id
  ), logged as (
    insert into public.credit_transactions (org_id, user_id, delta, reason, feature)
    select id, owner_id, 25, 'free_grant', null from updated
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $$;

-- service_role 만 실행 (cron admin client / lazy on-login server route).
revoke all on function public.issue_monthly_grant(uuid) from public;
revoke all on function public.issue_monthly_grant(uuid) from anon, authenticated;
grant execute on function public.issue_monthly_grant(uuid) to service_role;

revoke all on function public.issue_monthly_grants() from public;
revoke all on function public.issue_monthly_grants() from anon, authenticated;
grant execute on function public.issue_monthly_grants() to service_role;

-- ── 6. handle_new_user — 신규 org 에 grant 시딩 ───────────────────────────
-- 신규 org 는 월초 cron 을 기다리지 않고 가입 즉시 25cr grant 를 받는다(획득
-- 목적상 즉시 지급이 자연스럽다). 같은 달 free_grant 원장 row 를 남기므로
-- 그달 cron 은 이 org 를 멱등 스킵한다. (기존 10cr signup_grant 는 그대로.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org uuid;
  v_expires timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  -- trial_ends_at = now() + 24h 는 0009 에서 도입된 로직 — 반드시 보존.
  insert into public.organizations (name, owner_id, credit_balance, trial_ends_at, grant_credits, grant_expires_at)
  values (coalesce(new.raw_user_meta_data->>'full_name', new.email, 'Workspace'),
          new.id, 10, now() + interval '24 hours', 25, v_expires)
  returning id into new_org;

  insert into public.organization_members (org_id, user_id, role)
  values (new_org, new.id, 'owner');

  insert into public.credit_transactions (org_id, user_id, delta, reason)
  values (new_org, new.id, 10, 'signup_grant');

  insert into public.credit_transactions (org_id, user_id, delta, reason)
  values (new_org, new.id, 25, 'free_grant');

  return new;
end $$;
