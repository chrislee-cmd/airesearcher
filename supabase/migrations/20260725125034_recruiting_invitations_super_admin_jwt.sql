-- Fix: filing an invitation request failed with `permission denied for table
-- users`. Root cause = the `invitations_super_admin_all` policy
-- (20260704083100_recruiting_invitations.sql) gates on
--   exists (select 1 from auth.users where id = auth.uid() and email = …)
-- and is declared `for all`. On INSERT, a `for all` policy with only a USING
-- clause reuses that USING as its WITH CHECK, so a normal user's own insert
-- (through the RLS client, invitations_self_insert path) still forces Postgres
-- to evaluate the auth.users subquery under the `authenticated` role — which
-- has no SELECT privilege on `auth.users`. That raises a hard permission error
-- that aborts the statement before the permissive-policy OR can save it.
--
-- This class stayed hidden until R2 surfaced the raw insert error: every other
-- admin surface (sched_*) is service-role only, so RLS is bypassed and the
-- subquery never evaluates. recruiting_invitations is the one table whose
-- super-admin policy sits on a user-client insert path.
--
-- Fix: match the caller by the JWT `email` claim instead of a subquery against
-- auth.users. `auth.jwt() ->> 'email'` reads the token, touches no table, and
-- is the Supabase-supported pattern already used by
-- profiles_super_admin_* (20260704065847) and qa_feedbacks (20260704044952).
-- Semantics are preserved: the policy is a defense-in-depth backstop — the
-- admin GET/PATCH routes gate in code via isSuperAdminEmail and use the
-- service-role client (which bypasses RLS entirely). The self select/insert
-- policies are untouched, so a user still can't forge a request for someone
-- else (with check auth.uid() = requester_user_id).
--
-- additive/idempotent: drop-if-exists then recreate. No data change.
drop policy if exists "invitations_super_admin_all" on public.recruiting_invitations;
create policy "invitations_super_admin_all"
  on public.recruiting_invitations
  for all
  using (
    lower(auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  )
  with check (
    lower(auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
