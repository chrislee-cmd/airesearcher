-- 20261007062656_cron_heartbeats.sql
--
-- cron 생존 신호 — 성공 실행 기록 (위젯 체인 관측 PR-E).
--
-- 메우는 구멍: **침묵 ≠ 정상.** 기존 관측은 전부 "실패했을 때 신호가 난다"는
-- 구조다(error_events). 그래서 cron 이 **아예 안 도는** 경우 — vercel.json 에
-- 등록이 빠졌거나, 배포가 cron 을 떨어뜨렸거나, 플랫폼이 호출을 멈췄거나 —
-- error_events 에 아무것도 안 뜬다. 정상 가동과 완전 사망이 똑같은 모양(무음)
-- 이 된다. KeepAlive 크래시 루프를 아무도 몇 시간 모르고 있었던 것과 동형.
--
-- 해법: 실패가 아니라 **성공을 기록**한다. cron 이 한 바퀴 정상 완주할 때마다
-- 자기 이름의 행 하나를 now() 로 갱신하고, 어드민이 "마지막 실행 N분 전" 을
-- 보여 준다. 그 값이 주기의 2배를 넘으면 경고 — 이 한 줄이 "무음=정상" 가정을
-- 깬다. 판정선/주기 정의는 코드(src/lib/observability/cron-heartbeat.ts)가 SSOT.
--
-- ── 설계: 최신 1행 upsert (append-only 로그 아님) ──
-- job 을 PK 로 두고 매 실행이 같은 행을 덮는다. 쓰려는 질문이 "마지막으로 언제
-- 돌았나" 하나뿐이라 이력이 필요 없고, 행 수가 job 수로 고정되어 retention
-- 정리(cron 이 자기 로그를 무한히 쌓는 자기모순)가 아예 필요 없다. 실행 이력이
-- 필요해지면 그때 별도 append 테이블을 추가한다 — 이 테이블은 생존 신호 전용.
--
-- RLS: 조직 스코프가 없는 전역 운영 테이블이라 error_events 정책 컨벤션을
-- 미러한다 — super-admin 이메일만 select, write 는 service_role(cron)만.
--
-- 전부 additive(create table/index if not exists) + idempotent →
-- DESTRUCTIVE_RE(drop/alter type/rename/truncate/delete) 비대상이라 머지 시
-- apply-migrations 자동 적용 대상(PROJECT.md §7.5).

create table if not exists public.cron_heartbeats (
  -- cron job 식별자 — vercel.json 의 path 말단과 같은 슬러그('chain-sweep').
  -- PK 라서 같은 job 의 두 번째 실행은 insert 가 아니라 갱신이 된다.
  job        text primary key,
  -- 마지막 **성공 완주** 시각. 실패한 실행은 여기를 갱신하지 않는다 — 그래야
  -- "최근 성공" 이 신선도를 뜻하고, 실패 루프가 생존으로 위장하지 못한다.
  ran_at     timestamptz not null default now(),
  -- 그 실행이 훑은 후보 행 수. 0 이 정상(아무것도 정체 안 됨)이라, 이 값만으로는
  -- 생존을 판정할 수 없다 — ran_at 이 판정축이고 이것은 진단 보조값.
  scanned    integer not null default 0,
  -- 그 실행이 실제로 손댄 행 수(체인 sweep 이면 error 로 닫은 수).
  acted      integer not null default 0,
  -- 이 job 이 처음 기록된 시각(배포/등록 시점 추적용, 덮이지 않음).
  created_at timestamptz not null default now()
);

alter table public.cron_heartbeats enable row level security;

-- super-admin 만 읽는다(어드민 카드). 서버(service_role)는 RLS 를 우회하므로
-- cron 의 write 에는 정책이 필요 없다 — write 정책을 **의도적으로 두지 않아**
-- 일반 client 가 생존 신호를 위조하지 못하게 한다.
drop policy if exists "cron_heartbeats_super_admin_read" on public.cron_heartbeats;
create policy "cron_heartbeats_super_admin_read" on public.cron_heartbeats
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );
