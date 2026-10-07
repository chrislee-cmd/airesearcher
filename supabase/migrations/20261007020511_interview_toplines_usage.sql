-- 인터뷰 탑라인 — 생성 1회당 토큰/비용 실측 미터링(usage jsonb) 컬럼 추가.
--
-- 배경(과금 책정 선행): 탑라인 보고서 생성(현재 무과금)에 크레딧을 물리기로
-- 했으나 기능별 실측 COGS 가 없다. runTopline 의 map(문서별 Sonnet 추출)·
-- reduce(Opus 종합) 호출이 실제로 몇 토큰을 쓰는지 기록한 적이 없고,
-- /admin/api-usage 의 Anthropic cost_report 는 org 전체 $ 만 줘 기능 분해가
-- 불가능하다. 가격은 COGS 기반 마진 floor 불변식을 따라야 하므로 실측이
-- 선행이다. 이 컬럼은 측정 전용 — 차감(spendCredits)과는 무관하다.
--
-- shape(서버가 run 단위로 누적 write; resume hop 간 합산):
--   {
--     "map":    { "calls": int, "input_tokens": int, "output_tokens": int, "model": text },
--     "reduce": { "calls": int, "input_tokens": int, "output_tokens": int, "model": text },
--     "doc_count":   int,     -- 이 run 이 순회한 문서(응답자) 수
--     "est_cost_usd": numeric, -- 서버가 모델 단가 상수(lib/chains/llm-pricing.ts)로 계산
--     "measured_at":  timestamptz(text)
--   }
-- NULL = 미터링 이전 레거시 row 또는 측정이 아직 안 붙은 run. 서버/어드민이
-- NULL 을 "측정 없음"으로 정직하게 취급한다(backward compat). 집계 뷰는 두지
-- 않는다 — raw jsonb 를 어드민 쿼리가 코드로 집계한다(단일 계산 경로).
--
-- additive only(컬럼 추가) — DESTRUCTIVE_RE 비대상이라 머지 시 자동 적용된다
-- (PROJECT.md §7.5). if not exists 로 idempotent.

alter table public.interview_toplines
  add column if not exists usage jsonb;

comment on column public.interview_toplines.usage is
  '생성 1회당 토큰/비용 실측 미터링(과금 책정 선행). {map,reduce:{calls,input_tokens,output_tokens,model}, doc_count, est_cost_usd, measured_at}. NULL = 측정 없음(레거시). 측정 전용 — 차감과 무관.';
