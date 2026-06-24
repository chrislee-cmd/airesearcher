-- Persist the linked Google Sheet (responses dump) for each published
-- Google Form. The recruiting canvas widget surfaces this URL as a CTA
-- in its bottom-align output area so the user can jump straight from
-- the widget row to the spreadsheet of recruit responses.
--
-- We keep both `sheet_url` and `sheet_id` so future poll/sync jobs can
-- target the Sheets API without re-parsing the URL. Both are nullable
-- because (a) older form rows pre-date this feature, (b) auto-link can
-- fail when the user is missing the Sheets OAuth scope — the UI then
-- exposes a "시트 연결" fallback button per form.

alter table public.recruiting_forms
  add column if not exists sheet_url text,
  add column if not exists sheet_id text;

-- Owner can update their own form rows so the link-sheet API can patch
-- sheet_url/sheet_id after a successful Sheets API call. Service-role
-- inserts are unaffected (they bypass RLS).
drop policy if exists recruiting_forms_self_update on public.recruiting_forms;
create policy recruiting_forms_self_update
  on public.recruiting_forms for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
