-- account-exports — private bucket holding per-user GDPR export bundles
-- (PR-SEC6, SEC-005). Each export is a zip uploaded by the service-role
-- handler at /api/account/export and exposed to the user via a 24h
-- signed URL. Files live under `{user_id}/...` so future per-user cleanup
-- jobs can prefix-filter.
--
-- No RLS policies on storage.objects for this bucket: writes happen via
-- service role (bypasses RLS) and downloads use signed URLs (also bypass
-- RLS). Direct anon/authenticated access is denied by default — which is
-- the goal, since the bundle contains the user's full data dump and must
-- not be reachable without the signed token.

insert into storage.buckets (id, name, public, file_size_limit)
values ('account-exports', 'account-exports', false, 524288000)
on conflict (id) do nothing;
