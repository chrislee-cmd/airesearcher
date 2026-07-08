-- 인터뷰 탑라인 — 출력 언어(output_lang) 컬럼 추가.
--
-- 탑라인 보고서의 출력 언어를 입력(transcript) 언어와 독립적으로 선택 가능하게
-- (예: 영어 인터뷰 파일 → 한국어 분석 보고서). 이 값은 캐시 dedup 키의 일부다:
-- 문서셋 해시(content_hash)가 같아도 output_lang 이 다르면 재생성해서 옛 언어
-- 캐시가 오반환되지 않게 한다(route POST 캐시 히트 조건에 포함).
--
-- nullable + default 없음(NULL) — 이 마이그 이전에 생성된 레거시 row 는 NULL 로
-- 남고, 서버/클라이언트가 NULL 을 기본 언어(한국어)로 취급한다(backward compat).
-- check 제약은 두지 않는다: 값 검증은 route 의 zod enum(TOPLINE_OUTPUT_LANGS)이
-- 담당하고, 향후 언어 추가 시 마이그 없이 확장 가능하게 유지.

alter table public.interview_toplines
  add column if not exists output_lang text;

comment on column public.interview_toplines.output_lang is
  '탑라인 보고서 출력 언어(ko/en/ja/zh/es/th). NULL = 레거시/기본(한국어). content_hash 와 함께 캐시 dedup 키.';
