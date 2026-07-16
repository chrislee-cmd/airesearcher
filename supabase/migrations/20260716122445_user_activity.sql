-- user_activity — append-only mirror of client `track()` events into our own
-- DB (PR: user-activity-events-ingestion; feeds the admin "유저 관찰 대시보드"
-- timeline, card #611).
--
-- Why this exists: click-level behaviour was Mixpanel-only (see
-- src/components/mixpanel-provider.tsx track()) — nothing landed in our
-- database, so the admin timeline could not reconstruct a per-user click
-- stream. This table is the first-party sink. `track()` now dual-writes:
-- Mixpanel (unchanged) + a non-blocking beacon to /api/events, which inserts
-- one row here via the service role.
--
-- NOT retroactive: only events fired AFTER this migration deploys are
-- captured. Past behaviour is reconstructed by #611 from domain tables.
--
-- Privacy posture (raw product-usage events, distinct from audit_log which is
-- security/GDPR-scoped):
--   * event_key preserves the original (un-localized) event id.
--   * `props` is a sanitized whitelist written by the route — never raw form
--     input, never PII. email is NOT stored (join via user_id when needed).
--   * ip / user_agent are filled server-side (client cannot forge) for abuse
--     forensics; access is locked to self + super-admin by RLS.
--   * Retention: this is high-volume append-only data. A rolloff of ~180d on
--     created_at is the intended policy — implement as a follow-up pg_cron /
--     scheduled delete (out of scope for this PR; table + indexes only).
--
-- ⚠️ Additive migration — auto-applied on merge by apply-migrations.yml
-- (PROJECT.md §7.5). No destructive DDL.

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.user_activity (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_key   text not null,                 -- original event id (e.g. desk_generate_click)
  props       jsonb not null default '{}'::jsonb,  -- sanitized whitelist, no PII
  path        text,                          -- pathname the event fired from
  session_id  text,                          -- client-generated browser-session correlation id
  ip          text,                          -- server-filled (x-forwarded-for first hop on Vercel)
  user_agent  text,                          -- server-filled
  created_at  timestamptz not null default now()
);

-- Timeline read: "last N events for this user, newest first" (#611).
create index if not exists user_activity_user_created_idx
  on public.user_activity (user_id, created_at desc);

-- Aggregate read: "how often does event X fire", event-type rollups.
create index if not exists user_activity_event_created_idx
  on public.user_activity (event_key, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Writes are server-side only: the /api/events route uses the service
-- role (which bypasses RLS). We intentionally create NO insert/update/delete
-- policy, so `anon` / `authenticated` can never write directly and the table
-- stays effectively append-only (same posture as audit_log).
--
-- Reads: a user may see their OWN events (self-read), and the super admins
-- may read everyone's (the #611 timeline dashboard). The super-admin gate
-- uses the JWT `email` claim rather than a subquery against auth.users — the
-- `authenticated` role has no SELECT there, so an in-policy subquery would
-- fail instead of match. `auth.jwt() ->> 'email'` is the Supabase-supported
-- way to read the caller's email inside a policy (same pattern as
-- error_events_super_admin_read / landing_visits_super_admin_read).
alter table public.user_activity enable row level security;

drop policy if exists "user_activity_own_select" on public.user_activity;
create policy "user_activity_own_select" on public.user_activity
  for select using (user_id = auth.uid());

drop policy if exists "user_activity_super_admin_read" on public.user_activity;
create policy "user_activity_super_admin_read" on public.user_activity
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );
