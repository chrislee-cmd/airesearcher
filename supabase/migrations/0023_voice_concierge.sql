-- 0023_voice_concierge.sql
--
-- Voice Concierge — foundation tables (PR1).
--
-- A global bottom-right FAB on every (app) route opens an OpenAI Realtime
-- (gpt-realtime) speech-to-speech session. The user talks to "Mochi", the
-- model knows the whole product (features.ts + per-route hints), and can
-- navigate / start features / read user context via function calls.
--
-- This migration only stores the analytics + transcript layer. Audio bytes
-- are NEVER persisted — only the text transcript and tool-call metadata.
-- OpenAI Realtime wiring (RealtimeAgent / RealtimeSession, ephemeral
-- client secrets, /api/voice/* routes) lands in PR2/PR3.

-- ── voice_sessions ───────────────────────────────────────────────────────
create table public.voice_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id),

  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  -- Filled by /api/voice/sessions/:id/end (PR2). Snapshot of (ended_at -
  -- started_at) in seconds for fast aggregation without timestamp math.
  duration_sec    integer,

  locale          text not null default 'ko',
  -- Route the user was on when they opened the concierge. Useful for the
  -- "where does the concierge get called most" analytics (design §12.8).
  entry_route     text,

  -- Number of tool() calls the model made during this session. Lets the
  -- product team spot sessions where the concierge actually took action
  -- vs. pure chat.
  tool_calls      integer not null default 0,

  -- Cumulative credits charged. Stubbed at 0 in PR1 (free beta — credit
  -- policy still open, design §12.5). PR2/PR3 will wire whichever model
  -- the team picks (free + daily cap / per-minute / lump per session).
  credits_charged integer not null default 0
);

create index voice_sessions_org_idx
  on public.voice_sessions (org_id, started_at desc);

alter table public.voice_sessions enable row level security;

-- Host org members read their own sessions. Matches the translate /
-- desk_jobs RLS shape (0022 / 0006) — joins organization_members rather
-- than the bare `members` alias the design draft used.
create policy "voice_sessions_org_select"
on public.voice_sessions for select
using (
  exists (
    select 1 from public.organization_members m
    where m.org_id = voice_sessions.org_id
      and m.user_id = auth.uid()
  )
);
-- INSERT/UPDATE intentionally have no client policy. The /api/voice/*
-- routes (PR2) write via service-role, mirroring the translate_messages
-- forgery-defense pattern. Same reasoning: a client that could insert
-- arbitrary voice_sessions rows could backfill fake usage to bypass any
-- future per-session credit cap.

-- ── voice_messages (transcript) ──────────────────────────────────────────
-- One row per finalized utterance from either side, plus rows for tool
-- calls (role='tool', meta=payload). Audio bytes are never stored.
create table public.voice_messages (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.voice_sessions(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool')),
  text        text not null,
  -- For role='tool': { name, arguments, result } payload. For user/
  -- assistant rows: null (or future caption metadata like is_final).
  meta        jsonb,
  ts          timestamptz not null default now()
);

create index voice_messages_session_idx
  on public.voice_messages (session_id, ts);

alter table public.voice_messages enable row level security;

create policy "voice_messages_org_select"
on public.voice_messages for select
using (
  exists (
    select 1
    from public.voice_sessions s
    join public.organization_members m
      on m.org_id = s.org_id and m.user_id = auth.uid()
    where s.id = voice_messages.session_id
  )
);
-- INSERT는 클라이언트에서 직접 못함 — 호스트 API route 가 service-role 로 insert
-- (translate_messages 와 동일 패턴). 모델이 만든 transcript 를 사용자가
-- 위조해서 컨텍스트를 오염시키는 시나리오를 차단합니다.
