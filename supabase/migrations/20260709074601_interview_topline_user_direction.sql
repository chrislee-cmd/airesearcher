-- 인터뷰 탑라인 — 재생성 방향(user_direction) 컬럼 추가.
--
-- 사용자가 보고서를 "다시 생성"할 때 자유 텍스트로 분석 방향을 지정할 수 있게
-- (예: "가격 민감도 위주로 다시 정리해줘"). 이 값은 reduce(최종 보고서) system
-- prompt 에 사용자 요청 방향으로 주입돼 강조점·구성을 조정한다(근거 밖 생성은
-- 여전히 금지 — 방향은 초점 조정일 뿐 환각 허용 아님).
--
-- output_lang 과 동일하게 캐시 dedup 키의 일부다: 문서셋 해시(content_hash)와
-- 언어가 같아도 방향이 다르면 재생성해서 옛 방향 캐시가 오반환되지 않게 한다
-- (route POST 캐시 히트 조건에 포함).
--
-- nullable + default 없음(NULL) — 이 마이그 이전 레거시 row 와 방향 없이 생성한
-- row 는 NULL 로 남고, 서버/클라이언트가 NULL 을 "방향 없음" 으로 취급한다
-- (backward compat). 값 검증(길이 제한)은 route 의 zod 스키마가 담당하므로
-- check 제약은 두지 않는다.

alter table public.interview_toplines
  add column if not exists user_direction text;

comment on column public.interview_toplines.user_direction is
  '재생성 시 사용자가 지정한 분석 방향(자유 텍스트). NULL = 방향 없음. content_hash·output_lang 과 함께 캐시 dedup 키.';
