-- 회의록 모드(mode='meeting') 결과물에 붙는 LLM 후처리 산출물 —
-- "전체 요약 + Todo-list" 를 렌더 준비된 마크다운 블록으로 저장한다.
-- 전사 본문(markdown / clean_markdown)은 그대로 두고, 이 컬럼만 별도로 채워
-- preview / md / docx 렌더 시점에 본문 상단에 삽입한다.
--
-- nullable — 리서치 모드 잡은 항상 NULL, 회의록 잡도 후처리 실패 시 NULL 로
-- 남고 전사 본문은 정상 유지된다(요약만 skip). inferred_speakers 와 동일한
-- graceful-degrade 패턴(jobs-select 헬퍼)으로 마이그 미적용 환경에서도 select
-- 가 깨지지 않는다.
alter table public.transcript_jobs
  add column if not exists meeting_summary text;

comment on column public.transcript_jobs.meeting_summary is
  '회의록 모드 후처리 산출물(전체 요약 + Todo-list) 마크다운 블록. 리서치 모드/실패 시 NULL.';
