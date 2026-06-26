-- 20260626140000_account_delete_retention.sql
--
-- PR-SEC5 — GDPR Art. 17 (erasure) + Art. 5(1)(e) (storage limitation).
--
-- Two concerns, one migration because they're inseparable:
--
-- 1. Make `auth.admin.deleteUser(user_id)` actually erase a user's data.
--    Several FK constraints to auth.users(id) were created without
--    ON DELETE CASCADE / SET NULL, so a hard delete throws a FK violation
--    and leaves orphaned PII rows in place. We retrofit the cascades the
--    schema should have had, splitting between:
--       CASCADE   — pure PII (user-owned content that exists to serve
--                   the user; goes away with the user)
--       SET NULL  — legal/financial records we must keep (payments,
--                   credit_transactions, audit_log already does this).
--    `organizations.owner_id` cascades because the org is auto-provisioned
--    for one user on signup; deleting them dissolves their workspace and
--    every org_id-scoped child (transcripts, projects, generations, …)
--    follows via the existing org cascades.
--
-- 2. Retention cleanup functions called daily by
--    /api/cron/retention. Each returns the row count it deleted so the
--    cron route can surface it in the response body / Vercel logs.

-- ── 1. Cascade retrofits ─────────────────────────────────────────────────

-- organizations.owner_id — orgs are 1-user workspaces by default; without
-- cascade the user delete is blocked entirely.
alter table public.organizations
  drop constraint if exists organizations_owner_id_fkey,
  add constraint organizations_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;

-- credit_transactions.user_id — financial ledger row stays; just unattribute.
alter table public.credit_transactions
  drop constraint if exists credit_transactions_user_id_fkey,
  add constraint credit_transactions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

-- generations.user_id — user-owned PII. The org_id cascade already covers
-- the common solo-org case; this catches the cross-org member scenario.
alter table public.generations
  drop constraint if exists generations_user_id_fkey,
  add constraint generations_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- payments.user_id — financial record (tax/refund history). Loosen NOT
-- NULL so we can SET NULL on user delete without losing the row.
alter table public.payments
  alter column user_id drop not null,
  drop constraint if exists payments_user_id_fkey,
  add constraint payments_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

-- projects.created_by — projects are org-scoped; preserve the row and
-- unattribute the creator.
alter table public.projects
  drop constraint if exists projects_created_by_fkey,
  add constraint projects_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- folders.created_by — same shape as projects.
alter table public.folders
  drop constraint if exists folders_created_by_fkey,
  add constraint folders_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- insights_jobs.user_id — user-owned PII (uploaded quotes, transcripts).
alter table public.insights_jobs
  drop constraint if exists insights_jobs_user_id_fkey,
  add constraint insights_jobs_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- voice_sessions.user_id — user-owned PII (transcript of voice session).
alter table public.voice_sessions
  drop constraint if exists voice_sessions_user_id_fkey,
  add constraint voice_sessions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- translate_sessions.host_user_id — user-owned PII.
alter table public.translate_sessions
  drop constraint if exists translate_sessions_host_user_id_fkey,
  add constraint translate_sessions_host_user_id_fkey
    foreign key (host_user_id) references auth.users(id) on delete cascade;

-- translate_recordings.host_user_id — same.
alter table public.translate_recordings
  drop constraint if exists translate_recordings_host_user_id_fkey,
  add constraint translate_recordings_host_user_id_fkey
    foreign key (host_user_id) references auth.users(id) on delete cascade;


-- ── 2. Retention cleanup functions ───────────────────────────────────────

-- trial_fingerprints: kept just long enough to catch repeat-trial abuse on
-- the same machine (apply_trial_policy looks back 7 days). 90 days is a
-- comfortable margin and still well below any "retain forever" reading.
create or replace function public.cleanup_trial_fingerprints()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  with d as (
    delete from public.trial_fingerprints
    where first_seen_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into deleted_count from d;
  return deleted_count;
end $$;

-- voice_sessions: short-lived chat sessions. Caller picks the window so
-- the policy can be tuned without redeploying the function.
create or replace function public.cleanup_voice_sessions(p_days integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  with d as (
    delete from public.voice_sessions
    where started_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into deleted_count from d;
  return deleted_count;
end $$;

-- translate_messages: live-translation transcripts. The session row is
-- already torn down by /api/translate/cleanup; this prunes the long tail
-- of message rows that survived because their session is still 'live'.
create or replace function public.cleanup_translate_messages(p_days integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  with d as (
    delete from public.translate_messages
    where ts < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into deleted_count from d;
  return deleted_count;
end $$;

-- insights_jobs: "orphaned" here means failed jobs older than 30 days.
-- The schema has no project_id link to use as a parent, so we proxy on
-- failure status — ready/active jobs stay no matter how old.
create or replace function public.cleanup_orphaned_insights_jobs()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  with d as (
    delete from public.insights_jobs
    where status = 'failed'
      and created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into deleted_count from d;
  return deleted_count;
end $$;

-- audit_log: 1-year forensic window. Long enough for incident response
-- and compliance audits; short enough to bound PII held under
-- "legitimate interest" rather than user consent.
create or replace function public.cleanup_audit_log(p_days integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count integer;
begin
  with d as (
    delete from public.audit_log
    where created_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into deleted_count from d;
  return deleted_count;
end $$;

-- Lock execution to service_role. The cron route uses the service key;
-- no client should be able to bulk-delete rows by calling these RPCs.
revoke all on function public.cleanup_trial_fingerprints() from public;
revoke all on function public.cleanup_trial_fingerprints() from anon, authenticated;
grant  execute on function public.cleanup_trial_fingerprints() to service_role;

revoke all on function public.cleanup_voice_sessions(integer) from public;
revoke all on function public.cleanup_voice_sessions(integer) from anon, authenticated;
grant  execute on function public.cleanup_voice_sessions(integer) to service_role;

revoke all on function public.cleanup_translate_messages(integer) from public;
revoke all on function public.cleanup_translate_messages(integer) from anon, authenticated;
grant  execute on function public.cleanup_translate_messages(integer) to service_role;

revoke all on function public.cleanup_orphaned_insights_jobs() from public;
revoke all on function public.cleanup_orphaned_insights_jobs() from anon, authenticated;
grant  execute on function public.cleanup_orphaned_insights_jobs() to service_role;

revoke all on function public.cleanup_audit_log(integer) from public;
revoke all on function public.cleanup_audit_log(integer) from anon, authenticated;
grant  execute on function public.cleanup_audit_log(integer) to service_role;
