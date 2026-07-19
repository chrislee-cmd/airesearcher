-- probing_session_runs.source 계측값에 'both'(mic+tab 병렬 캡처) 추가.
--
-- pr-probing-mic-plus-tab-dual-capture: 프로빙 both 모드(진행자 mic + 응답자 tab
-- 병렬 캡처)가 세션 캡처 소스를 'both' 로 기록할 수 있게 CHECK 제약을 확장한다.
-- 기존 제약은 20260710142638_probing_session_runs.sql 의 인라인 컬럼 체크
-- (source in ('mic','tab')) — Postgres 기본명 probing_session_runs_source_check.
--
-- drop constraint if exists + add constraint 는 additive(데이터 소실 없음)이며
-- 재실행 안전(drop-if-exists 가 앞서 항상 제거 후 재생성). 이 마이그는 auto-apply
-- destructive 게이트(drop table/column, type change, rename, truncate, delete)에
-- 해당하지 않아 머지 시 자동 적용된다.
alter table public.probing_session_runs
  drop constraint if exists probing_session_runs_source_check;

alter table public.probing_session_runs
  add constraint probing_session_runs_source_check
  check (source in ('mic', 'tab', 'both'));
