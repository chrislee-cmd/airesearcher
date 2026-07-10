-- 20260710155935_translate_sessions_error_status.sql
--
-- OBS-4 실패 상태값 보강 — 동시통역(translate_sessions) 실패 상태 신설.
--
-- 배경: translate_sessions.status 는 idle/live/ended 3-값 뿐이라 세션이
-- 실패(연결 끊김 / OpenAI ephemeral·LiveKit 토큰 실패 / connect 타임아웃)해도
-- 유령 'idle' 이나 'ended' 로 남았다. 관리자 대시보드(admin/analytics)의
-- "동시통역 실패율" 행이 항상 fail=0 → 노랑(errorRate null)이던 근본 원인.
--
-- 이 마이그레이션은:
--   1. status check 에 'error' 를 추가한다(기존 idle/live/ended 는 그대로).
--   2. 실패 사유를 담는 error_message 컬럼을 추가한다(대시보드 사유 그루핑용).
--
-- error_code enum 은 신설하지 않는다 — error_message 텍스트로 그루핑 충분
-- (OBS-4 결정 3, 과설계 회피). 클라이언트 teardown 경로가 세션 실패 시
-- POST /api/translate/sessions/:id/end { reason } 로 status='error' 를 배선한다.

-- status check 재정의 — 'error' 추가.
alter table public.translate_sessions
  drop constraint if exists translate_sessions_status_check;

alter table public.translate_sessions
  add constraint translate_sessions_status_check
  check (status in ('idle','live','ended','error'));

-- 실패 사유(자유 텍스트, 클라이언트가 넘긴 reason 을 500자로 절단해 기록).
-- NULL = 정상 종료(ended) 또는 아직 실패 안 한 세션.
alter table public.translate_sessions
  add column if not exists error_message text;
