-- 인터뷰 탑라인 — 산출물 출처(source) 컬럼 추가.
--
-- 탑라인 보고서가 어떻게 만들어졌는지 구분한다:
--   'generated' (또는 NULL/레거시) — 기존 풀 파이프라인. raw 인터뷰 전수를
--                                    map-reduce 로 Opus 가 생성한 보고서.
--   'uploaded'                     — 편집전용 모드(신규). 사용자가 외부
--                                    (Claude/NotebookLM 등)에서 완성한 보고서를
--                                    Markdown 으로 업로드해 blocks 로 파싱·저장한
--                                    것. 생성 파이프라인(Opus) 호출 없음.
--
-- 용도: (a) 재생성 UI 가 업로드 보고서를 덮어쓰기 전에 경고를 띄우고(업로드 원본
-- 이 사라짐), (b) 향후 모드 전환/필터. blocks 구조·편집 도구(edit_block, 섹션
-- 삽입, drag-to-ask)는 두 모드가 동일하게 공유하므로 이 컬럼은 순수 메타 마커다.
--
-- nullable + default 없음(NULL) — 이 마이그 이전 row 는 NULL 로 남고 서버/클라가
-- NULL 을 'generated'(기본)로 취급한다(backward compat). check 제약은 두지
-- 않는다: 값 검증은 서버 코드가 담당하고 향후 출처 추가 시 마이그 없이 확장 가능.

alter table public.interview_toplines
  add column if not exists source text;

comment on column public.interview_toplines.source is
  '탑라인 산출물 출처. NULL/generated = 풀 파이프라인 생성물, uploaded = 편집전용 외부 보고서 업로드. 편집/blocks 구조는 두 모드 공통.';
