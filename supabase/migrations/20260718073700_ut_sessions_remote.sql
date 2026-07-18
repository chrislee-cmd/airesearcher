-- AI UT — remote participant model (additive extension of ut_sessions).
--
-- Pivot: AI UT was single-device self-capture (a researcher records their OWN
-- screen). The real use is a researcher OBSERVING a different, ordinary user's
-- natural usage. This migration turns ut_sessions into a remote-participant
-- session: the researcher issues a shareable link (participant_token), the
-- participant opens it in THEIR OWN browser, shares their screen once, and the
-- researcher monitors live over a LiveKit room. task_goal carries the task the
-- researcher poses (also used as analysis context downstream — vision/report).
--
-- Everything here is ADDITIVE. mode defaults to 'local', so existing local
-- self-capture sessions (613·614) behave exactly as before — no regression.
-- The remote path is authorized purely by participant_token (the participant is
-- NOT an authenticated user); all participant reads/writes go through
-- service-role API routes + the security-definer RPC below, never a client RLS
-- policy. Recording/transcript ownership stays with the researcher.

-- ── Columns (all additive, idempotent) ────────────────────────────────────
alter table public.ut_sessions
  add column if not exists task_goal            text,           -- researcher-posed task / goal (analysis context)
  add column if not exists mode                 text not null default 'local',  -- 'local' self-capture | 'remote' participant
  add column if not exists participant_token    text,           -- share-link token (nullable; remote only)
  add column if not exists livekit_room         text,           -- LiveKit room name (remote live monitor)
  add column if not exists participant_joined_at timestamptz,   -- stamped when the participant first joins/publishes
  add column if not exists session_kind         text not null default 'moderated';  -- 'moderated' | 'unmoderated'

-- ── Value constraints (named so they're idempotent + auto-apply safe) ──────
-- `drop constraint` (not `drop table/column`) is NOT flagged by the merge
-- auto-apply destructive gate (§7.5), so extending the status enum applies
-- cleanly. We widen the status walk with the remote lifecycle:
--   remote: waiting (link issued, no participant yet) → live (participant
--           joined + publishing) → uploading → transcribing → done | error
--   local : recording → uploading → transcribing → done | error (unchanged)
alter table public.ut_sessions drop constraint if exists ut_sessions_status_check;
alter table public.ut_sessions add constraint ut_sessions_status_check
  check (status in ('recording','uploading','transcribing','done','error','waiting','live'));

alter table public.ut_sessions drop constraint if exists ut_sessions_mode_check;
alter table public.ut_sessions add constraint ut_sessions_mode_check
  check (mode in ('local','remote'));

alter table public.ut_sessions drop constraint if exists ut_sessions_session_kind_check;
alter table public.ut_sessions add constraint ut_sessions_session_kind_check
  check (session_kind in ('moderated','unmoderated'));

-- ── participant_token index (unique where present) ─────────────────────────
-- Partial unique so many local sessions (token NULL) coexist while every
-- issued remote token is globally unique + fast to resolve. Mirrors
-- translate_sessions.share_token.
create unique index if not exists ut_sessions_participant_token_uniq
  on public.ut_sessions (participant_token)
  where participant_token is not null;

-- ── Public-facing RPC (anon participant entry) ─────────────────────────────
-- Same pattern as get_translate_session_by_token (0022): expose one narrow
-- security-definer function to anon instead of an anon SELECT policy, so the
-- table schema stays private and token validation is centralized. Only remote
-- sessions resolve; ended/done sessions still resolve so the participant page
-- can render a "session ended" notice.
create or replace function public.get_ut_session_by_token(p_token text)
returns table (
  id            uuid,
  task_goal     text,
  target_url    text,
  livekit_room  text,
  session_kind  text,
  mode          text,
  status        text
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.task_goal, s.target_url, s.livekit_room, s.session_kind,
         s.mode, s.status
  from public.ut_sessions s
  where s.participant_token = p_token
    and s.mode = 'remote'
  limit 1;
$$;

grant execute on function public.get_ut_session_by_token(text) to anon, authenticated;

-- ── RLS note ───────────────────────────────────────────────────────────────
-- No new table/storage policies needed. The researcher (owner) already reads
-- their own rows via ut_sessions_self_read; super-admin via the super-admin
-- policy. Remote recordings are stored under the OWNER's {user_id} prefix in
-- the existing private ut-audio / ut-recording buckets (server-minted signed
-- upload URLs bypass RLS), so ownership + the retention obligation from
-- 20260717002652_ut_sessions.sql carry over unchanged. The participant never
-- touches the table or buckets directly — only the token-scoped service-role
-- API routes do.
