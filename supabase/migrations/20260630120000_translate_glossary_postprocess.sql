-- AI 동시통역 — output 품질 ↑: glossary + 사후 post-process 보정.
--
-- 두 가지를 translate_sessions 에 추가한다:
--
-- 1. glossary (jsonb 배열) — host 가 세션 시작 전 입력하는 인명/고유명사/
--    약어의 정규 표기 list. 실시간 translations 엔드포인트는 instructions /
--    source-lang hint 를 거부하므로 (openai-realtime.ts 참고) glossary 는
--    실시간 경로에 주입할 수 없다. 대신 사후 보정 LLM pass (post-process)
--    와 batch 재번역 (revise) 의 system prompt 에 주입돼 같은 사람/도구의
--    음차 흔들림을 정규 표기로 통일하는 hint 로 쓰인다. 빈 배열이 기본 —
--    glossary 없이도 옛 동작 그대로.
--
-- 2. post-process lifecycle — revise 와 별개의 LLM pass. revise 는 source
--    (kind='input') 행을 처음부터 다시 번역하지만, post-process 는 실시간
--    통역 OUTPUT (kind='output') 전사록 전체를 한 번에 검토해 단어 융합 /
--    인명 표기 / soundalike / 의미 압축을 교정하고, 불확실 구간은 임의
--    복원하지 않고 플래그(⟦?⟧ 류)를 남긴다. 결과는 교정 로그 + 플래그가
--    포함된 markdown artifact 로 post_process_md 에 저장한다 (source 행은
--    SSOT 로 유지 — 원본을 덮어쓰지 않는다).
--
--    lifecycle (revise 와 동일 패턴):
--      idle    → 한 번도 발동 안 됨 (기본)
--      pending → host 가 트리거, LLM 호출 중 (동시 트리거 락)
--      done    → post_process_md 작성됨
--      failed  → LLM 또는 DB 실패 (post_process_error 에 사유)
--    실패 시 host 재트리거를 위해 'failed' → 'pending' 전이 허용.

alter table public.translate_sessions
  add column if not exists glossary jsonb not null default '[]'::jsonb,
  add column if not exists post_process_status text
    not null default 'idle'
    check (post_process_status in ('idle','pending','done','failed')),
  add column if not exists post_process_model text,
  add column if not exists post_process_started_at timestamptz,
  add column if not exists post_process_completed_at timestamptz,
  add column if not exists post_process_error text,
  add column if not exists post_process_flags integer,
  add column if not exists post_process_md text;
