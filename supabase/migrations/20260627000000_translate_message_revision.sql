-- AI 동시통역 — 사후 batch 재번역 (PR-T3).
--
-- 동시통역 LLM 의 fundamental limit (실시간 압축/의역/누락) 을 보완하기
-- 위해, 세션 종료 후 host 가 "재번역" 을 발동하면 보존된 source-language
-- transcript (kind='input' 행) 를 batch 로 다시 번역한 결과를 같은 행에
-- 저장한다. 이렇게 하면:
--   - 원본 transcript (input.text)
--   - 실시간 통역 (output.text)
--   - 사후 재번역 (input.revised_text)
-- 세 가지를 한 세션에서 비교 / export 할 수 있다.
--
-- revised_text 는 kind='input' 행에만 의미가 있다 (output 행은 실시간
-- 통역 결과이므로 재번역과 무관). check 제약은 두지 않고 NULL 로 두며,
-- 어플리케이션 단에서 input 행만 업데이트한다.
--
-- translate_sessions 에는 revision job 의 lifecycle 을 기록한다:
--   idle    → 한 번도 발동 안 됨 (기본)
--   pending → host 가 트리거, LLM 호출 중
--   done    → 모든 input 행에 revised_text 채워짐
--   failed  → LLM 또는 DB 실패 (revision_error 에 사유)
-- 실패 시 host 가 다시 트리거할 수 있도록 'failed' → 'pending' 전이 허용.

alter table public.translate_messages
  add column if not exists revised_text text;

alter table public.translate_sessions
  add column if not exists revision_status text
    not null default 'idle'
    check (revision_status in ('idle','pending','done','failed')),
  add column if not exists revision_model text,
  add column if not exists revision_started_at timestamptz,
  add column if not exists revision_completed_at timestamptz,
  add column if not exists revision_error text;

-- Update the public RPC so the late-join viewer endpoint and the
-- transcript download route also surface revised_text. The viewer
-- itself never reads revised_text (it only renders live captions)
-- but the host-side download route reuses this signature via the
-- service-role admin client, and the RPC return shape needs to stay
-- the SSOT for what columns are visible.
--
-- CREATE OR REPLACE FUNCTION refuses to change the return type, so
-- drop + recreate. Same pattern as PR-T2's speaker column migration.
drop function if exists public.get_translate_transcript(text, timestamptz, integer);

create or replace function public.get_translate_transcript(
  p_token text,
  p_since timestamptz default '1970-01-01'::timestamptz,
  p_limit integer default 500
)
returns table (
  kind         text,
  text         text,
  lang         text,
  speaker      text,
  revised_text text,
  ts           timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.kind, m.text, m.lang, m.speaker, m.revised_text, m.ts
  from public.translate_messages m
  join public.translate_sessions s on s.id = m.session_id
  where s.share_token = p_token
    and s.record_enabled = true
    and (s.expires_at is null or s.expires_at > now())
    and m.ts > p_since
  order by m.ts asc
  limit greatest(1, least(p_limit, 2000));
$$;

grant execute on function public.get_translate_transcript(text, timestamptz, integer)
  to anon, authenticated;
