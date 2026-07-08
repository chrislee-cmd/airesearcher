-- 인터뷰 탑라인 생성 durable 잡화 — 300초 함수 벽을 넘겨 대형 프로젝트 완주 (카드 #434).
--
-- 배경 (2026-07-08 실측): 문서 42개 프로젝트가 map 10/42 에서 3시간째 generating
-- 좀비. root cause = maxDuration=300 한 함수 안에서 map(문서별 Sonnet 호출) +
-- reduce(Opus) 를 통째로 돌려 대형 프로젝트가 5분 벽 안에 완주 불가 → 함수 킬 →
-- runTopline catch 도 못 돌아 row 가 generating 에 영구 잔존.
--
-- 해결: 한 함수 호출을 시간예산(~230s) 배치로 쪼개고, 남은 작업이 있으면
-- 스스로 새 함수 호출(/api/interviews/v2/topline/resume)을 kick 해 이어간다.
-- map 은 이미 interview_topline_doc_extracts (document_id, content_hash) 캐시가
-- 있어 재진입 시 완료분 재map 0 — 캐시가 사실상 map 커서다. 이 마이그는 그
-- 재개 루프가 "어느 단계까지 왔는지" 를 영속하는 상태 컬럼을 추가한다:
--
--   phase        : 'map' | 'reduce' — 현재 재개 단계. null = 레거시(단일-패스
--                  방식으로 만들어진 row). map 전수 완료 후 reduce 로 넘어간다.
--   map_cursor   : 지금까지 추출이 영속된(캐시된) 문서 수 = durable map 커서의
--                  숫자 미러. map_done 과 함께 진행률/관측에 쓴다(재개해도
--                  0 으로 리셋되지 않음 — 캐시 기준으로 이어짐).
--   resume_count : self-kick 홉 카운터. 무한 재개 루프 방지 가드(루프가 정해진
--                  상한을 넘으면 stepper 가 error 로 종료). 새 생성마다 0 리셋.
--
-- heartbeat 는 별도 컬럼을 두지 않고 기존 updated_at (매 UPDATE 마다 트리거로
-- bump — interview_toplines_updated_at) 을 재사용한다. PR #863(카드 #483) 의
-- stuck 판정(isToplineGeneratingStale)이 이미 updated_at 을 heartbeat 으로
-- 쓰고 있어, 재개 루프의 각 배치 진행 update 가 곧 heartbeat 갱신이 된다.
--
-- 모두 additive(if not exists) — 기존 row/로직과 하위 호환. 레거시 row 는
-- phase=null 로 남아도 stepper 가 캐시 기준으로 단계를 재유도한다.

alter table public.interview_toplines
  add column if not exists phase text
    check (phase is null or phase in ('map', 'reduce')),
  add column if not exists map_cursor integer not null default 0,
  add column if not exists resume_count integer not null default 0;
