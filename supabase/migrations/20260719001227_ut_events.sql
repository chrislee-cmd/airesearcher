-- AI UT — behavior-analytics layer (card 622). ADDITIVE extension of
-- ut_sessions (20260717002652 / 20260718073700). This is the QUANTITATIVE
-- layer: a machine-readable interaction event stream + aggregated micro-signals
-- inferred by vision post-processing of the screen recording. It deliberately
-- does NOT store qualitative narration / clips — that is card 626 (TwelveLabs).
--
-- Pipeline (server-side, no capture-path change): the finalized ut-recording
-- webm is sampled by a vision model into quantitative events {t_ms, type,
-- confidence, meta}. Those rows aggregate deterministically (rule-based, in
-- code — reproducible) into ut_sessions.behavior_metrics (rage-click counts,
-- hesitation ms, scroll depth, backtrack counts, step timing, friction
-- hotspots). Events are INFERRED (not precise DOM), so every row carries a
-- confidence the UI renders faded when low.
--
-- Status walk gains 'analyzing': after transcription reaches 'done', the widget
-- fires analysis → status flips to 'analyzing' → back to 'done' once metrics
-- land. Analysis failure never fails the whole session (transcript already
-- succeeded) — it stamps meta.analysis.error and restores 'done'.

-- ── behavior_metrics column (additive, idempotent) ─────────────────────────
alter table public.ut_sessions
  add column if not exists behavior_metrics jsonb;   -- null until analysis completes

-- Widen the status enum with 'analyzing' (drop constraint, not table/column, so
-- the merge auto-apply destructive gate — §7.5 — does not flag it).
alter table public.ut_sessions drop constraint if exists ut_sessions_status_check;
alter table public.ut_sessions add constraint ut_sessions_status_check
  check (status in ('recording','uploading','transcribing','done','error','waiting','live','analyzing'));

-- ── ut_events table ────────────────────────────────────────────────────────
-- One inferred interaction event per row. `type` is the minimal quantitative
-- taxonomy (no qualitative "what/why" label — that is 626). `confidence` ∈
-- [0,1] drives the faded-when-low UI treatment. `meta` holds small quantitative
-- context only (normalized cursor x/y, scroll depth, cluster size) — NEVER
-- sensitive captured text; the extractor masks card/password-shaped strings
-- before they reach here.
create table if not exists public.ut_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.ut_sessions(id) on delete cascade,
  t_ms        integer not null,          -- offset from session start
  type        text not null
              check (type in ('click','scroll','input','navigate',
                              'hover_hesitation','rage_click','backtrack')),
  confidence  real not null default 0.5, -- 0..1 (inferred, not precise DOM)
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- Primary access pattern: one session's events on the time axis (timeline view
-- + deterministic aggregation both scan ordered by t_ms).
create index if not exists ut_events_session_t_idx
  on public.ut_events (session_id, t_ms);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same posture as ut_sessions: the owner (and super-admin) may read; all writes
-- go through the service role in the analyze route. A user reaches events only
-- for a session they own — enforced by an EXISTS against ut_sessions rather
-- than a direct column, since ut_events has no user_id of its own.
alter table public.ut_events enable row level security;

create policy "ut_events_self_read" on public.ut_events
  for select using (
    exists (
      select 1 from public.ut_sessions s
      where s.id = ut_events.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "ut_events_super_admin_read" on public.ut_events
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );

-- No INSERT/UPDATE/DELETE policy: events are written only by the service-role
-- analyze route (POST /api/ut/sessions/[id]/analyze), never by the client.
-- Realtime is not enabled — the widget polls GET /api/ut/sessions/[id] for
-- behavior_metrics + events, matching the existing transcript polling.
