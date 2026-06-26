-- audit_log — append-only ledger of security/privacy-relevant events.
--
-- GDPR Art. 30 (records of processing) + audit obligations: we keep a
-- forensic trail of authentication events, permission denials, consent
-- changes, data exports / deletions, and admin actions. Service-role only
-- writes — clients never insert directly. `actor_email` is denormalized so
-- the row remains useful after the user row is deleted (Art. 17 erasure).
--
-- Read access defaults to "your own rows"; org admin readability is added
-- when org-level audit dashboards land (separate PR).

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  -- preserved after user deletion so the trail survives erasure requests.
  actor_email text,
  -- canonical event types (extensible — string column not enum):
  --   consent_granted, consent_revoked,
  --   account_deleted, account_exported,
  --   login_success, login_failure,
  --   permission_denied, rate_limited,
  --   admin_action
  event_type text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Org admin "show me the last N events" read pattern.
create index if not exists audit_log_org_event_idx
  on public.audit_log (org_id, event_type, created_at desc);

-- Per-user history (own audit page, support ticket lookup).
create index if not exists audit_log_user_idx
  on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;

-- Self-read: any authenticated user sees their own events.
drop policy if exists "audit_log_own_select" on public.audit_log;
create policy "audit_log_own_select" on public.audit_log
  for select using (user_id = auth.uid());

-- Org admin read: org owners/admins see their org's events. (Members of
-- the same org without admin role cannot — audit data is admin-scope.)
drop policy if exists "audit_log_org_admin_select" on public.audit_log;
create policy "audit_log_org_admin_select" on public.audit_log
  for select using (
    org_id is not null and public.has_org_role(org_id, 'admin')
  );

-- Writes are server-side only. We intentionally do NOT create any insert
-- / update / delete policy: service_role bypasses RLS, and the absence of
-- a policy means anon / authenticated cannot write. The trail is
-- effectively append-only — no policy ever allows update or delete.


-- user_consents — per-user consent records (GDPR Art. 7 demonstrability).
--
-- Each row captures one consent decision (granted or revoked) for a
-- specific consent type at a specific policy version. Re-consent on
-- policy version bumps inserts a new row; we don't update older rows so
-- the granted_at / revoked_at history is preserved.

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- canonical types: privacy_policy, terms_of_service, marketing,
  -- analytics, llm_processing
  consent_type text not null,
  granted boolean not null,
  -- e.g. 'v1.0', '2026-05-23'. Policy text changes bump version so
  -- "still has consent" checks compare against the current version.
  version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- IP, user agent, source (signup / banner / settings), banner choices
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists user_consents_user_type_idx
  on public.user_consents (user_id, consent_type, granted_at desc);

alter table public.user_consents enable row level security;

drop policy if exists "user_consents_own_select" on public.user_consents;
create policy "user_consents_own_select" on public.user_consents
  for select using (user_id = auth.uid());

drop policy if exists "user_consents_own_insert" on public.user_consents;
create policy "user_consents_own_insert" on public.user_consents
  for insert with check (user_id = auth.uid());

drop policy if exists "user_consents_own_update" on public.user_consents;
create policy "user_consents_own_update" on public.user_consents
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
