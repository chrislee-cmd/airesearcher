-- Super-admin management access to profiles for the QA tester management UI
-- (/admin/qa-testers). The super admin lists every profile and flips
-- is_qa_tester on/off. The base RLS on profiles (0001_init.sql) only grants
-- self-scoped access:
--   profiles_self_select  →  auth.uid() = id
--   profiles_self_update  →  auth.uid() = id
-- so without these policies the super admin could only see/edit their OWN
-- row and the management table would render a single line.
--
-- Both policies gate on the JWT `email` claim, matching the qa_feedbacks
-- convention (20260704044952_qa_feedbacks.sql). We deliberately do NOT use
-- `exists (select 1 from auth.users where id = auth.uid() and email = …)`:
-- the `authenticated` role has no SELECT privilege on `auth.users`, so that
-- subquery fails to match instead of erroring (see the qa_feedbacks note).
-- `auth.jwt() ->> 'email'` is the Supabase-supported way to read the caller's
-- email inside a policy.
--
-- RLS policies are permissive (OR-combined) by default, so these ADD super
-- admin access on top of the existing self policies without weakening them.

-- Super admin reads every profile (needed to render the full tester list).
create policy "profiles_super_admin_select" on public.profiles
  for select using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );

-- Super admin updates any profile (needed to toggle is_qa_tester).
create policy "profiles_super_admin_update" on public.profiles
  for update using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
