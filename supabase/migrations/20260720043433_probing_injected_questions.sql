-- probing_sessions.injected_questions — 사용자가 세션 전 "반드시 확인하고 싶은
-- 질문"으로 주입하는 질문 리스트 (V2 세팅 STEP4, 결정 ②).
--
-- 배경: 기존 STEP4 = research_goal(freetext). 결정 ②로 goal 폐기 → 번호배지
-- 질문 리스트로 대체. 이 PR(PR-B)은 "UI + 저장"까지 — 질문이 프로빙 엔진 시드로
-- 실제 반영되는 경로(think 프롬프트 주입)는 별도 product-backend 검증 (research_goal
-- 은 dormant 로 계약 유지, 이 컬럼은 추가만).
--
-- additive only — 기존 row/컬럼 불변. 머지 시 자동 적용(apply-migrations.yml).
-- 재실행 안전 (if not exists).

alter table public.probing_sessions
  add column if not exists injected_questions text[] not null default '{}';
