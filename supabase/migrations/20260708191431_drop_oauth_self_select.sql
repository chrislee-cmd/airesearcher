-- Security (P0): remove browser read access to user_google_oauth.
--
-- 0012 created `user_google_oauth_self_select` (for select using
-- auth.uid() = user_id), which let a user's browser session (anon key + JWT
-- via PostgREST) SELECT its own row — including the long-lived Google
-- refresh_token. That token outlives the session cookie, so an XSS or a
-- malicious extension could exfiltrate a credential that survives logout.
--
-- The product never needs the browser to read this row: every write and read
-- is server-side (OAuth callback / forms-publish / share routes, all using the
-- service role), and account-export explicitly strips it. Dropping the policy
-- leaves RLS enabled with zero policies = deny-all for anon/authenticated —
-- the same service-role-only shape as cache_entries / trial_fingerprints.
--
-- Any server route that previously relied on this policy (share status/sheets/
-- docs read via the user-scoped client) is migrated to the service-role admin
-- client in the same PR.

drop policy if exists user_google_oauth_self_select on public.user_google_oauth;
