-- 동시접속 정원 게이트 backend — 가상 대기실 (Postgres only, 새 인프라 X).
--
-- 배경: 초기 런칭에 동시접속이 몰리면 서비스가 터진다 (100 동시접속 감사 =
-- 현 구조 못 버팀). 근본 확장성 수정 전까지의 안전밸브 — 앱 진입 시 동시접속
-- 인원을 판정해 cap(기본 5) 초과면 대기열에 넣고, 앞사람이 나가면 자동 입장.
-- 계정당 1슬롯, FIFO 공정성, 슈퍼어드민 우회(route 레벨).
--
-- Upstash(Redis)는 prod 미프로비저닝(보안감사 확인) → Redis 의존 없이
-- Supabase Postgres 만으로. 이 마이그는 backend(스키마 + RPC)만 — 진입
-- 게이트/대기실 UI 는 후속 PR (#505, blocked_by 이 PR).
--
-- 핵심 = count+admit 을 pg_advisory_xact_lock 으로 원자화 → 동시 6명이 cap 5
-- 를 뚫는 레이스를 원천 차단(§검증 "정확히 5만 admitted").
--
-- RLS: 두 테이블 모두 정책 0개(직접 접근 전면 차단). service_role 은 RLS 를
-- bypass 하므로 게이트 라우트(service key)만 조작. admit_or_enqueue RPC 는
-- SECURITY DEFINER + service_role 에만 EXECUTE — authenticated 가 직접 호출해
-- 남의 account_id 를 admit 시키는 것을 막는다(route 가 서버 검증된 user.id 만
-- 전달).
--
-- Realtime 불요 — waiting client 는 /api/gate/ping 을 5s 주기로 poll 한다
-- (§7.8 해당 없음, publication 추가 X).

------------------------------------------------------------------------
-- 1) active_sessions — 살아있는 세션. 계정당 1행(pk=account_id).
--    살아있음 = last_seen > now() - ACTIVE_TTL. cap 계산의 분자.
------------------------------------------------------------------------

create table if not exists public.active_sessions (
  account_id  uuid primary key references auth.users(id) on delete cascade,
  admitted_at timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- sweep(좀비 제거) + count 둘 다 last_seen 을 스캔.
create index if not exists active_sessions_last_seen_idx
  on public.active_sessions (last_seen);

alter table public.active_sessions enable row level security;
-- 정책 0개 — service_role(RLS bypass)만 접근. anon/authenticated 는 read/write
-- 모두 거부. 클라이언트는 오직 /api/gate/* 라우트 경유.

------------------------------------------------------------------------
-- 2) concurrency_queue — 대기열. 계정당 1행(pk=account_id), FIFO(enqueued_at).
--    last_poll 이 QUEUE_TTL 넘게 끊기면 이탈로 간주(대기 중 탭 닫음 등).
------------------------------------------------------------------------

create table if not exists public.concurrency_queue (
  account_id  uuid primary key references auth.users(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  last_poll   timestamptz not null default now()
);

-- FIFO 순서 조회(맨 앞 승격 + position 계산).
create index if not exists concurrency_queue_enqueued_at_idx
  on public.concurrency_queue (enqueued_at);
-- sweep(이탈자 제거)는 last_poll 스캔.
create index if not exists concurrency_queue_last_poll_idx
  on public.concurrency_queue (last_poll);

alter table public.concurrency_queue enable row level security;
-- 정책 0개 — active_sessions 와 동일한 service-only 락다운.

------------------------------------------------------------------------
-- 3) admit_or_enqueue — 원자적 admit/enqueue 판정 (레이스 방지 핵심).
--
-- advisory xact lock 으로 count+admit 전체를 직렬화한다. cap 은 Vercel env
-- (CONCURRENCY_CAP)에서 route 가 읽어 p_cap 으로 전달 — Postgres 함수는 앱
-- env 를 못 읽으므로 파라미터화(spec 의 admit_or_enqueue(p_account_id) 최소
-- 확장). TTL 은 하트비트 20s / poll 5s 를 기준으로 한 SQL 상수.
--
-- 반환(jsonb):
--   admitted 면 {status:'admitted'}
--   대기면   {status:'waiting', position, cap, active_count}
-- 멱등: 같은 계정 반복 호출은 admitted 갱신(하트비트) / waiting position 갱신.
------------------------------------------------------------------------

create or replace function public.admit_or_enqueue(
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
  -- 전체 count+admit 임계 구역 직렬화. 고정 키(hashtext 로 유도) — 동시 호출
  -- 은 이 락에서 줄 서므로 "동시 6명이 cap 5 뚫기"가 원천 불가.
  perform pg_advisory_xact_lock(hashtext('concurrency_gate'));

  -- (1) lazy sweep — 좀비 active + 이탈 대기자 제거. 매 ping 마다 실행되어
  --     ping 이 도는 한 슬롯이 자동으로 풀린다(cron sweep 은 백스톱).
  delete from public.active_sessions where last_seen < now() - active_ttl;
  delete from public.concurrency_queue where last_poll < now() - queue_ttl;

  -- (2) 이미 active 면 last_seen 갱신 후 admitted (= 하트비트 겸용).
  update public.active_sessions
     set last_seen = now()
   where account_id = p_account_id;
  if found then
    return jsonb_build_object('status', 'admitted');
  end if;

  select count(*) into v_active_count from public.active_sessions;

  -- 대기열 맨 앞(FIFO). 새치기 방지 — 자리가 나도 앞선 대기자가 우선.
  select account_id into v_front
    from public.concurrency_queue
   order by enqueued_at asc
   limit 1;

  -- (3) 자리 있고 && (대기열 비었거나 내가 맨 앞) 이면 admit.
  if v_active_count < p_cap and (v_front is null or v_front = p_account_id) then
    insert into public.active_sessions (account_id, admitted_at, last_seen)
    values (p_account_id, now(), now())
    on conflict (account_id) do update set last_seen = now();
    -- 대기열에 있었다면 승격됐으니 제거.
    delete from public.concurrency_queue where account_id = p_account_id;
    return jsonb_build_object('status', 'admitted');
  end if;

  -- (4) 대기 — enqueue(신규) 또는 last_poll 갱신(기존). enqueued_at 은
  --     최초 진입 시각을 보존(재폴링이 순번을 뒤로 밀지 않도록 do update 는
  --     last_poll 만 건드린다).
  insert into public.concurrency_queue (account_id, enqueued_at, last_poll)
  values (p_account_id, now(), now())
  on conflict (account_id) do update set last_poll = now();

  -- position = 나보다 앞선 대기자 수 + 1 (1-based, 맨 앞이면 1).
  select count(*) into v_ahead
    from public.concurrency_queue q
   where q.enqueued_at < (
     select enqueued_at from public.concurrency_queue where account_id = p_account_id
   );

  return jsonb_build_object(
    'status', 'waiting',
    'position', v_ahead + 1,
    'cap', p_cap,
    'active_count', v_active_count
  );
end;
$$;

-- authenticated 가 직접 호출해 임의 account_id 를 admit 시키는 것을 차단.
-- 게이트 라우트가 service key 로 서버 검증된 user.id 만 전달한다.
revoke all on function public.admit_or_enqueue(uuid, int) from public;
revoke all on function public.admit_or_enqueue(uuid, int) from anon;
revoke all on function public.admit_or_enqueue(uuid, int) from authenticated;
grant execute on function public.admit_or_enqueue(uuid, int) to service_role;
