-- Landing visit capture — native traffic pipeline for the analytics dashboard
-- (PR: landing-visit-capture; feeds card #575: 접속자 추이 / 유입소스 / 리텐션).
-- The app had no native pageview capture (PostHog is wired but NEXT_PUBLIC_
-- POSTHOG_KEY is unset → 0 pageviews), so this is the first-party replacement.
--
-- A client beacon on the locale root landing page POSTs referrer + UTM +
-- a first-party localStorage session_id to /api/track/landing, which inserts
-- one row here via the service role. Privacy posture (intentional):
--   * NO raw IP — only a coarse `country` derived from the x-vercel-ip-country
--     header. IP never touches this table.
--   * First-party id only (localStorage uuid). No third-party cookies.
--   * user_id is filled only when the visitor already has a session (rare on
--     the landing page, which redirects logged-in users to /canvas).
--
-- ⚠️ This migration is NOT auto-applied by the Vercel build (PROJECT.md §7.5).
-- Run `supabase db push --linked --yes` against prod after merge, or the
-- /api/track/landing insert will fail against a missing table.

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.landing_visits (
  id             uuid primary key default gen_random_uuid(),
  session_id     text not null,                 -- first-party localStorage uuid (new vs returning)
  path           text,                          -- landing pathname (e.g. /ko, /en)
  referrer       text,                          -- raw document.referrer
  referrer_host  text,                          -- host parsed from referrer (grouping key)
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_term       text,
  utm_content    text,
  country        text,                          -- from x-vercel-ip-country header (no raw IP)
  user_agent     text,
  user_id        uuid references auth.users(id) on delete set null,  -- null for anonymous
  created_at     timestamptz not null default now()
);

-- Dashboard queries: recent-first time series, source breakdown, campaign rollup.
create index if not exists landing_visits_created_at_idx
  on public.landing_visits (created_at desc);
create index if not exists landing_visits_referrer_host_idx
  on public.landing_visits (referrer_host);
create index if not exists landing_visits_utm_source_idx
  on public.landing_visits (utm_source);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Client code never touches this table directly. Inserts happen only through
-- the /api/track/landing route using the service role (which bypasses RLS).
-- The single policy grants the super admin read access for the dashboard.
--
-- NOTE: the gate uses the JWT `email` claim rather than a subquery against
-- auth.users — the `authenticated` role has no SELECT privilege there, so an
-- in-policy subquery fails instead of matching. `auth.jwt() ->> 'email'` is
-- the Supabase-supported way to read the caller's email inside a policy
-- (same pattern as qa_feedbacks_super_admin_read).
alter table public.landing_visits enable row level security;

create policy "landing_visits_super_admin_read" on public.landing_visits
  for select using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
