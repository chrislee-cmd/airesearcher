-- P0 게이트 유령 슬롯 근절 — admit_or_enqueue 정원 계산에서 stale 세션 배제 + TTL 확정.
--
-- 배경(사용자 prod bisection 2026-07-10): 위젯 사용자가 fresh 로그인 즉시
-- "슬롯 대기 중". 근본 = 하트비트 끊긴 유령 widget_active_uses row 가 위젯
-- 정원(cap=CONCURRENCY_CAP=5)을 점유 → admit 이 정원초과 판정 → 신규 유저 waiting.
--
-- (이 게이트는 #504 의 전역 active_sessions 모델이 아니라 #511(20260709085039)
--  의 위젯 키축 모델이다. spec 의 'active_sessions'/'org 정원' 표현은 구 모델
--  용어 — 실제 대상 테이블은 public.widget_active_uses(위젯별 cap).)
--
-- 이 마이그의 두 가지 변경 (다른 로직·시그니처·권한은 20260709085039 그대로):
--
--   1) 정원 count 에서 stale row 명시 배제 (decision C — 이중 안전).
--      기존 함수는 count 직전에 stale 을 delete 하므로 count 는 이미 fresh 만
--      센다. 하지만 delete 와 count 가 서로 다른 임계(TTL)에 의존하게 되는
--      미래 회귀를 막기 위해, count 자체를 `last_seen >= now() - active_ttl`
--      로 필터한다. delete 가 어떤 이유로 누락돼도(락 경합/부분 실패) 유령이
--      cap 계산에 절대 안 잡히도록 하는 방어선. sweep(cron/lazy) 지연 대비.
--
--   2) active_ttl 45s → 60s (하트비트 20s 의 3배, decision B).
--      45s(2.25배)는 연속 2회 하트비트 유실(약 40s 네트워크 블립/GC 정지)에
--      너무 빠듯해 정상 세션을 오삭제할 수 있었다 — 오삭제된 세션이 다음
--      하트비트에서 cap 초과를 만나 waiting 으로 밀리는 회귀 경로. 60s(3배)는
--      2회 유실 + jitter 를 흡수하면서도 진짜 유령을 60s + cron 60s ≈ 2분
--      안에 회수한다. (#817 topline stale lease TTL 자동복구와 동형 사상.)
--      queue_ttl(30s, poll 5s 의 6배)은 충분해 그대로 둔다.
--
-- ⚠️ sweep cron(src/app/api/gate/sweep/route.ts)의 ACTIVE_TTL_SECONDS 도 반드시
--    이 active_ttl 과 일치(60)해야 한다 — 두 곳의 TTL 이 어긋나면 sweep 기준이
--    RPC 와 달라진다. 이 PR 에서 route 상수도 함께 60 으로 맞춘다.

create or replace function public.admit_or_enqueue(
  p_widget_key text,
  p_account_id uuid,
  p_cap int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  -- 하트비트 20s 의 3배. 이 시간 넘게 last_seen 이 안 오면 좀비로 간주.
  -- sweep/route.ts 의 ACTIVE_TTL_SECONDS 와 동일해야 한다.
  active_ttl constant interval := interval '60 seconds';
  -- waiting poll 5s 의 여러 배. 대기 중 탭 닫으면 이탈로 정리.
  queue_ttl  constant interval := interval '30 seconds';
  v_active_count int;
  v_front        uuid;
  v_ahead        int;
begin
  -- 이 위젯의 count+admit 임계 구역만 직렬화한다. 위젯별 락 키라 서로 다른
  -- 위젯은 이 락에서 줄 서지 않는다(병렬성 유지). 같은 위젯의 동시 호출만
  -- 줄 서므로 "동시 6명이 한 위젯의 cap 5 뚫기"가 원천 불가.
  perform pg_advisory_xact_lock(hashtext('widget_gate:' || p_widget_key));

  -- (1) lazy sweep — 이 위젯의 좀비 active + 이탈 대기자만 제거. 매 ping 마다
  --     실행되어 ping 이 도는 한 슬롯이 자동으로 풀린다(cron sweep 은 백스톱).
  delete from public.widget_active_uses
   where widget_key = p_widget_key and last_seen < now() - active_ttl;
  delete from public.widget_use_queue
   where widget_key = p_widget_key and last_poll < now() - queue_ttl;

  -- (2) 이미 이 위젯에서 active 면 last_seen 갱신 후 admitted (= 하트비트 겸용).
  update public.widget_active_uses
     set last_seen = now()
   where widget_key = p_widget_key and account_id = p_account_id;
  if found then
    return jsonb_build_object('status', 'admitted', 'widget_key', p_widget_key);
  end if;

  -- 정원 = fresh(하트비트 유효) active 만. (1)의 delete 가 이미 stale 을 지웠지만
  -- delete 누락 대비 count 자체에서도 stale 을 배제한다(decision C, 이중 안전).
  select count(*) into v_active_count
    from public.widget_active_uses
   where widget_key = p_widget_key
     and last_seen >= now() - active_ttl;

  -- 이 위젯 대기열 맨 앞(FIFO). 새치기 방지 — 자리가 나도 앞선 대기자가 우선.
  select account_id into v_front
    from public.widget_use_queue
   where widget_key = p_widget_key
   order by enqueued_at asc
   limit 1;

  -- (3) 자리 있고 && (이 위젯 대기열 비었거나 내가 맨 앞) 이면 admit.
  if v_active_count < p_cap and (v_front is null or v_front = p_account_id) then
    insert into public.widget_active_uses (widget_key, account_id, admitted_at, last_seen)
    values (p_widget_key, p_account_id, now(), now())
    on conflict (widget_key, account_id) do update set last_seen = now();
    -- 대기열에 있었다면 승격됐으니 제거.
    delete from public.widget_use_queue
     where widget_key = p_widget_key and account_id = p_account_id;
    return jsonb_build_object('status', 'admitted', 'widget_key', p_widget_key);
  end if;

  -- (4) 대기 — enqueue(신규) 또는 last_poll 갱신(기존). enqueued_at 은 최초
  --     진입 시각을 보존(재폴링이 순번을 뒤로 밀지 않도록 do update 는 last_poll
  --     만 건드린다).
  insert into public.widget_use_queue (widget_key, account_id, enqueued_at, last_poll)
  values (p_widget_key, p_account_id, now(), now())
  on conflict (widget_key, account_id) do update set last_poll = now();

  -- position = 이 위젯에서 나보다 앞선 대기자 수 + 1 (1-based, 맨 앞이면 1).
  select count(*) into v_ahead
    from public.widget_use_queue q
   where q.widget_key = p_widget_key
     and q.enqueued_at < (
       select enqueued_at from public.widget_use_queue
        where widget_key = p_widget_key and account_id = p_account_id
     );

  return jsonb_build_object(
    'status', 'waiting',
    'widget_key', p_widget_key,
    'position', v_ahead + 1,
    'cap', p_cap,
    'active_count', v_active_count
  );
end;
$$;

-- 권한은 20260709085039 에서 이미 service_role EXECUTE 로 고정 — create or replace
-- 는 기존 grant 를 보존하므로 재선언 불필요.
