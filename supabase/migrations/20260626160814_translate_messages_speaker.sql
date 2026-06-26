-- AI 동시통역 — speaker label on transcript rows (PR-T2).
--
-- Adds a nullable `speaker` text column to translate_messages so the
-- host console can tag each finalized line as the host (interviewer)
-- vs. guest (interviewee). Source is the inputSource picker:
--   - 'mic' capture  → 'host'   (interviewer talking through their mic)
--   - 'tab' capture  → 'guest'  (interviewee on a tab-shared call)
-- Output rows (the translated TTS transcript) inherit the same speaker
-- since they're a translation of the same person's utterance.
--
-- Legacy rows stay NULL and the export renderers fall back to an
-- "unknown" tag — no backfill, no break.

alter table public.translate_messages
  add column if not exists speaker text
  check (speaker in ('host', 'guest'));

-- Update the public RPC so the late-join viewer endpoint and the
-- transcript download route both pick up the new column. CREATE OR
-- REPLACE FUNCTION refuses to change the return type, so drop + recreate.
drop function if exists public.get_translate_transcript(text, timestamptz, integer);

create or replace function public.get_translate_transcript(
  p_token text,
  p_since timestamptz default '1970-01-01'::timestamptz,
  p_limit integer default 500
)
returns table (
  kind    text,
  text    text,
  lang    text,
  speaker text,
  ts      timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.kind, m.text, m.lang, m.speaker, m.ts
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
