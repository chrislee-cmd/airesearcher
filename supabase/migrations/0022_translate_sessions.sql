-- 0022_translate_sessions.sql
--
-- AI 동시통역 (Realtime Translate) feature — foundation tables.
--
-- A host runs OpenAI Realtime (gpt-realtime) in the browser and publishes
-- two audio tracks (original + translated TTS) into a LiveKit Cloud room.
-- Captions stream over Supabase broadcast. A short share_token grants
-- public (anon) viewers read-only access via RPC.
--
-- This migration only sets up the storage layer. OpenAI/LiveKit wiring
-- lands in subsequent PRs.

-- ── translate_sessions ────────────────────────────────────────────────────
create table public.translate_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  host_user_id    uuid not null references auth.users(id),

  -- nanoid(21). NULL ⇒ share link not yet issued or has been revoked.
  share_token     text unique,

  source_lang     text not null default 'ko',
  target_lang     text not null default 'en',

  -- idle  → before host clicks 시작
  -- live  → host published; viewers can subscribe
  -- ended → host stopped or expired; viewers see "세션 종료" notice
  status          text not null default 'idle'
                  check (status in ('idle','live','ended')),

  -- LiveKit room name. Server fills with 'translate:' || id at create time.
  livekit_room    text not null default '',

  -- 전사록 보관. 기본 ON (유실 시 치명적). 호스트가 명시적으로 끄면 false.
  record_enabled  boolean not null default true,

  started_at      timestamptz,
  ended_at        timestamptz,
  expires_at      timestamptz,

  -- 누적 차감 크레딧. 시작 lump(50) + 10분당 catch-up(10).
  -- 서버(service-role) 만 갱신.
  credits_charged integer not null default 0,

  created_at      timestamptz not null default now()
);

create index translate_sessions_org_idx
  on public.translate_sessions (org_id, created_at desc);

create unique index translate_sessions_share_token_uniq
  on public.translate_sessions (share_token)
  where share_token is not null;

alter table public.translate_sessions enable row level security;

-- Host's org members read their own sessions.
create policy "translate_sessions_org_select"
on public.translate_sessions for select
using (
  exists (
    select 1 from public.organization_members m
    where m.org_id = translate_sessions.org_id
      and m.user_id = auth.uid()
  )
);

-- Only the host (creator) can mutate. Cross-org admins go through
-- service-role; in-app cleanup tasks belong to the host.
create policy "translate_sessions_host_insert"
on public.translate_sessions for insert
with check (
  host_user_id = auth.uid()
  and exists (
    select 1 from public.organization_members m
    where m.org_id = translate_sessions.org_id
      and m.user_id = auth.uid()
  )
);

create policy "translate_sessions_host_update"
on public.translate_sessions for update
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

-- ── translate_messages (captions/transcript) ──────────────────────────────
-- Stored only when record_enabled = true (server-side gate). Anon viewers
-- never SELECT this table directly; backfill goes through an RPC.
create table public.translate_messages (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.translate_sessions(id) on delete cascade,
  kind        text not null check (kind in ('input','output')),
  text        text not null,
  lang        text,
  ts          timestamptz not null default now()
);

create index translate_messages_session_idx
  on public.translate_messages (session_id, ts);

alter table public.translate_messages enable row level security;

create policy "translate_messages_org_select"
on public.translate_messages for select
using (
  exists (
    select 1
    from public.translate_sessions s
    join public.organization_members m
      on m.org_id = s.org_id and m.user_id = auth.uid()
    where s.id = translate_messages.session_id
  )
);
-- INSERT는 클라이언트에서 직접 못함 — 호스트 API route 가 service-role 로 insert.

-- ── public-facing RPCs (anon viewer 진입) ─────────────────────────────────
-- Following the scheduler/booking pattern (0015): expose a narrow function
-- to anon instead of an anon SELECT policy. This keeps the table schema
-- private and centralizes token validation.

create or replace function public.get_translate_session_by_token(p_token text)
returns table (
  id           uuid,
  source_lang  text,
  target_lang  text,
  status       text,
  livekit_room text,
  record_enabled boolean,
  started_at   timestamptz,
  expires_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.source_lang, s.target_lang, s.status, s.livekit_room,
         s.record_enabled, s.started_at, s.expires_at
  from public.translate_sessions s
  where s.share_token = p_token
    and s.status in ('idle','live','ended')
    and (s.expires_at is null or s.expires_at > now())
  limit 1;
$$;

grant execute on function public.get_translate_session_by_token(text)
  to anon, authenticated;

-- Backfill captions for a late-joining viewer. Returns empty if the host
-- has disabled recording (record_enabled=false) — captions are live-only
-- in that mode.
create or replace function public.get_translate_transcript(
  p_token text,
  p_since timestamptz default '1970-01-01'::timestamptz,
  p_limit integer default 500
)
returns table (
  kind text,
  text text,
  lang text,
  ts   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.kind, m.text, m.lang, m.ts
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
