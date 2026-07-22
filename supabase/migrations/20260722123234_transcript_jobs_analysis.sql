-- research 모드 전사 결과의 LLM 후처리 산출물 — "AI 요약 + Key themes" 를
-- 구조화 JSON 으로 저장한다. 전사 풀뷰 V2 detail(state 05) 우측 rail 이 이
-- 컬럼을 렌더한다. shape:
--   { "summary": string, "themes": [ { "label": string, "count": number } ] }
--
-- 전사 본문(markdown / clean_markdown)은 그대로 두고 이 컬럼만 별도로 채운다.
-- nullable — 미생성(아직 요약 안 돌린 잡)/생성 실패 시 NULL 로 남고, UI 는
-- '생성' CTA(스텁)로 폴백한다. meeting_summary / inferred_speakers 와 동일한
-- graceful-degrade 패턴(jobs-select 헬퍼의 OPTIONAL_COLUMNS)으로 마이그 미적용
-- preview 환경에서도 select/update 가 깨지지 않는다.
alter table public.transcript_jobs
  add column if not exists analysis jsonb;

comment on column public.transcript_jobs.analysis is
  'research 모드 전사 LLM 후처리 산출물 {summary, themes:[{label,count}]}. 미생성/실패 시 NULL.';
