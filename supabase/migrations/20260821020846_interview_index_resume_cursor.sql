-- 인터뷰 인덱싱 잡 — 호출 간 재개(cursor) durable 상태 (카드 #608).
--
-- 배경 (2026-08-21 프로덕션 포렌식): /api/interviews/index 는 maxDuration=300
-- 한 함수 호출 안에서 배치 전체 파일(9파일 × ~250청크 ≈ 2,200청크)을 동기
-- 임베딩+HNSW 삽입한다. 5분 벽을 넘기면 플랫폼이 함수를 강제 종료(uncatchable)
-- → 완료 마킹(done/error)에 도달 못 함 → 잡이 index_status='indexing' 에 영구
-- 정지(26~48분째 관측). 탑라인엔 resume-sweep cron 이 있으나 인덱싱엔 대응
-- watchdog/재개가 없어 아무도 고아 잡을 살리지 않았다.
--
-- 해결(탑라인 durable-resume 패턴 이식): 한 호출을 시간예산(~210s) 안에서 처리
-- 가능한 만큼만 진행하고, 남은 작업이 있으면 스스로 새 함수 호출을 kick 해
-- 이어간다. 죽은 홉은 index-resume-sweep cron 이 재점화한다. 이 마이그는 그
-- 재개 루프가 "얼마나 진전했는지 / 몇 번 재점화했는지" 를 영속하는 컬럼을 더한다:
--
--   index_resume_count : 진전 없는 재점화(resurrection) 카운터 — 무한 재개 루프
--                        방지 가드. 진전이 감지되면 0 으로 리셋되고(healthy hop),
--                        같은 지점에서 진전 없이 반복 재점화되면 누적 → 상한 초과
--                        시 sweep 이 index_status='error' 로 정직하게 종결한다.
--                        새 인덱싱 시작마다 0 리셋.
--   index_cursor       : 마지막으로 관측된 잡의 총 삽입 청크 수 = 진전 판정 기준.
--                        sweep/voluntary-yield 가 현재 삽입량과 비교해 진전 여부를
--                        판정(현재 > cursor 면 진전 → resume_count 리셋).
--
-- heartbeat 는 별도 컬럼을 두지 않고 기존 updated_at(매 UPDATE 마다 트리거
-- touch_interview_jobs 로 bump)을 재사용한다. 인덱싱 루프가 주기적으로
-- interview_jobs 를 touch 해 updated_at 을 갱신 → 살아 있는 홉은 sweep 의 stale
-- 창을 넘기지 않아 오탐되지 않는다.
--
-- 모두 additive(if not exists) — 기존 row/로직과 하위 호환. 레거시 잡은 두 값이
-- 0 으로 남고 첫 재점화 때부터 정상 동작한다.

alter table public.interview_jobs
  add column if not exists index_resume_count integer not null default 0,
  add column if not exists index_cursor integer not null default 0;
