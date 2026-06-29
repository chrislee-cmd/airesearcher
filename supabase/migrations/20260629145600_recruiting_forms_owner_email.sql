-- Track which Google account owns the Drive copy of each published
-- recruiting form. Older rows (per-user OAuth, pre admin-proxy) stay
-- NULL — the responses route reads this to decide whether to fetch
-- with admin token (when set to the admin email) or fall back to the
-- requesting user's OAuth token (legacy backward compat).
--
-- Default + index intentionally omitted: this column is descriptive,
-- not part of any query plan. The recruiting widget filters by
-- user_id (still authoritative for "did you publish this form?").

alter table public.recruiting_forms
  add column if not exists owner_email text;
