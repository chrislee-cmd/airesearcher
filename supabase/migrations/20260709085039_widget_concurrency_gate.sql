-- 위젯별 동시사용 게이트 backend — 앱 전역 → 위젯 키축 전환.
--
-- 배경(사용자 2026-07-09): 앱 진입 자체를 막는 건 과함. 캔버스는 전원 입장,
-- 대신 위젯(FeatureKey)별로 동시사용 5명 제한 + 초과 시 위젯별 대기열. 병목은
-- 위젯별 비싼 작업이지 로그인이 아니다.
--
-- 이 마이그는 #504(20260708203321_concurrency_gate.sql)의 전역 모델을 대체한다:
--   구: active_sessions(account_id pk) + concurrency_queue(account_id pk)
--       + admit_or_enqueue(p_account_id, p_cap) — 계정당 1행, 전역 락 1개.
--   신: widget_active_uses(pk (widget_key, account_id))
--       + widget_use_queue(pk (widget_key, account_id))
--       + admit_or_enqueue(p_widget_key, p_account_id, p_cap) — (위젯,계정)당
--         1행, 위젯별 advisory lock(위젯끼리 직렬화 안 함 → 데스크가 붐벼도
--         통역은 무관, 병렬성 유지).
--
-- widget_key = FeatureKey 문자열(src/lib/features.ts, 예 'translate'/'desk'/
-- 'probing'/'quotes'/'interviews'/'recruiting'). free-text 로 두고(앱이 SSOT)
-- DB enum 강제는 안 함 — features.ts 변경마다 마이그 필요해지는 결합 회피.
--
-- Upstash(Redis)는 prod 미프로비저닝 → Redis 의존 없이 Supabase Postgres 만으로.
-- 이 마이그는 backend(스키마 + RPC)만 — 위젯 국소 게이트 UI 는 후속 PR(#512).
--
-- RLS: 두 테이블 모두 정책 0개(직접 접근 전면 차단). service_role 이 RLS 를
-- bypass 하므로 게이트 라우트(service key)만 조작한다.

------------------------------------------------------------------------
-- 0) 구 전역 모델 폐기 (drop). #504 인프라를 위젯 키축으로 대체.
--    RPC 는 시그니처(uuid,int)로 명시 drop — 아래 신 RPC 는 (text,uuid,int).
------------------------------------------------------------------------

drop function if exists public.admit_or_enqueue(uuid, int);
drop table if exists public.active_sessions;
drop table if exists public.concurrency_queue;

------------------------------------------------------------------------
-- 1) widget_active_uses — 위젯별 살아있는 사용. (위젯,계정)당 1행.
--    살아있음 = last_seen > now() - ACTIVE_TTL. 위젯별 cap 계산의 분자.
------------------------------------------------------------------------

create table if not exists public.widget_active_uses (
  widget_key  text not null,
  account_id  uuid not null references auth.users(id) on delete cascade,
  admitted_at timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (widget_key, account_id)
);

-- sweep(좀비 제거) + count 는 (widget_key, last_seen) 을 스캔.
create index if not exists widget_active_uses_key_last_seen_idx
  on public.widget_active_uses (widget_key, last_seen);

alter table public.widget_active_uses enable row level security;
-- 정책 0개 — service_role(RLS bypass)만 접근. anon/authenticated 는 read/write
-- 모두 거부. 클라이언트는 오직 /api/gate/* 라우트 경유.

------------------------------------------------------------------------
-- 2) widget_use_queue — 위젯별 대기열. (위젯,계정)당 1행, FIFO(enqueued_at).
--    last_poll 이 QUEUE_TTL 넘게 끊기면 이탈로 간주(대기 중 탭 닫음 등).
------------------------------------------------------------------------

create table if not exists public.widget_use_queue (
  widget_key  text not null,
  account_id  uuid not null references auth.users(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  last_poll   timestamptz not null default now(),
  primary key (widget_key, account_id)
);

-- 위젯별 FIFO 순서 조회(맨 앞 승격 + position 계산).
create index if not exists widget_use_queue_key_enqueued_at_idx
  on public.widget_use_queue (widget_key, enqueued_at);
-- sweep(이탈자 제거)는 (widget_key, last_poll) 스캔.
create index if not exists widget_use_queue_key_last_poll_idx
  on public.widget_use_queue (widget_key, last_poll);

alter table public.widget_use_queue enable row level security;
-- 정책 0개 — widget_active_uses 와 동일한 service-only 락다운.

------------------------------------------------------------------------
-- 3) admit_or_enqueue — 위젯별 원자적 admit/enqueue 판정 (레이스 방지 핵심).
--
-- 위젯별 advisory xact lock 으로 (해당 위젯의) count+admit 을 직렬화한다.
-- 락 키 = hashtext('widget_gate:' || p_widget_key) → 서로 다른 위젯은 다른
-- 락이라 병렬 진행(데스크가 붐벼도 통역 게이트는 무관). cap 은 Vercel env
-- (CONCURRENCY_CAP)에서 route 가 읽어 p_cap 으로 전달 — Postgres 함수는 앱
-- env 를 못 읽으므로 파라미터화. TTL 은 하트비트 20s / poll 5s 를 기준으로 한
-- SQL 상수(#504 값 재사용: active 45s / queue 30s).
--
-- 반환(jsonb):
--   admitted 면 {status:'admitted', widget_key}
--   대기면   {status:'waiting', widget_key, position, cap, active_count}
-- 멱등: 같은 (위젯,계정) 반복 호출은 admitted 갱신(하트비트) / waiting position 갱신.
------------------------------------------------------------------------

create or replace function public.admit_or_enqueue(
  p_widget_key text,
  p_account_id uuid,
  p_cap int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  -- 하트비트 20s 의 ~2배. 이 시간 넘게 last_seen 이 안 오면 좀비로 간주.
  active_ttl constant interval := interval '45 seconds';
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

  select count(*) into v_active_count
    from public.widget_active_uses
   where widget_key = p_widget_key;

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

-- authenticated 가 직접 호출해 임의 account_id 를 admit 시키는 것을 차단.
-- 게이트 라우트가 service key 로 서버 검증된 user.id 만 전달한다.
revoke all on function public.admit_or_enqueue(text, uuid, int) from public;
revoke all on function public.admit_or_enqueue(text, uuid, int) from anon;
revoke all on function public.admit_or_enqueue(text, uuid, int) from authenticated;
grant execute on function public.admit_or_enqueue(text, uuid, int) to service_role;
