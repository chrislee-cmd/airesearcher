-- probing_questions.is_core — 핵심 질문 토글 (PR-13).
--
-- 인터뷰어가 위젯에 표시된 각 질문을 ★ 로 마킹해 "이 질문은 중요" 표시.
-- 한 row 단위. default false. 표시는 시각만 (정렬은 기존 created_at DESC 유지)
-- 라 위치는 안 바뀌고 핑크 wash 로 강조만 됨.
--
-- 인덱스는 is_core = true 인 row 만 — 본인 user 의 핵심 질문 list 가 미래
-- export / share / focus view 의 빠른 read path 가 되도록.

alter table public.probing_questions
  add column if not exists is_core boolean not null default false;

create index if not exists probing_questions_user_core_idx
  on public.probing_questions (user_id)
  where is_core = true;
