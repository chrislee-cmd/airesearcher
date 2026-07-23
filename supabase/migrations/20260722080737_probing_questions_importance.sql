-- probing_questions.importance — 질문 중요도 영속화 (풀뷰 V2 Spotlight).
--
-- 풀뷰 V2 (pr-fullview-probing): high-importance 질문은 전체 화면 Spotlight
-- 모달로 표시된다. importance 는 EMIT 스트림 / in-memory PopupQuestion 에는
-- 존재하지만(`probing-types.ts` importance: high|medium|low) 컬럼엔 없어
-- 새로고침 시 유실됐다. 히스토리가 새로고침 후에도 중요도(별표/스포트라이트
-- 이력)를 보존하도록 additive 컬럼을 추가한다.
--
-- additive only — 기존 행은 null 로 남고(중요도 미상), 신규 emit 은
-- questions POST 페이로드로 값을 채운다. 파괴적 변경 없음.

alter table public.probing_questions
  add column if not exists importance text;
