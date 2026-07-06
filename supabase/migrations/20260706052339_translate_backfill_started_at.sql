-- 20260706052339_translate_backfill_started_at.sql
--
-- AI 동시통역 — backfill translate_sessions.started_at.
--
-- Root cause (see /api/translate/sessions/[id]/start): the host console
-- flipped go-live with a `void`-discarded supabase thenable that never
-- sent the PATCH, so started_at was NEVER written for any session. The
-- write path is fixed forward (server /start route). This migration
-- repairs the historical rows so export/history/viewer start-time and
-- the cleanup straggler clause have data to work with.
--
-- Approximation: the first persisted caption's `ts` is the closest proxy
-- for when the session actually went live. Sessions with no captions
-- (record_enabled=false, or produced no output) carry no start signal
-- and are left NULL — they had no transcript content to time anyway.
-- Idempotent: only NULL rows are touched.

update public.translate_sessions s
set started_at = m.first_ts
from (
  select session_id, min(ts) as first_ts
  from public.translate_messages
  group by session_id
) m
where m.session_id = s.id
  and s.started_at is null;
