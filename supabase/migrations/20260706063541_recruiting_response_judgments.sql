-- recruiting_response_judgments — DB cache for the LLM persona-fit judgment
-- of each recruiting-form respondent. The fullview 응답자 리스트 will show a
-- 종합 판단(성별/연령/거주지 + 페르소나 부합도) instead of the raw spreadsheet;
-- re-judging every respondent on every page load would be slow and costly, so
-- each respondent's judgment is cached here keyed by (form_id, response_key).
--
-- Cost-control design (see spec pr-recruiting-persona-fit-judgment-backend):
--   * 배치 — the judge lib judges up to ~20 respondents per LLM call, but the
--     cache is per-respondent so incremental loads only judge the new rows.
--   * 증분 — the judgments route reads this table first and only judges the
--     response_keys that are missing.
--   * criteria_hash — a stable hash of the form's 참여자 조건(criteria) at judge
--     time. When the recruiter edits the conditions the hash changes, so the
--     route treats every cached row with a stale hash as un-judged and
--     re-judges the whole form. Rows judged with no criteria (demographics
--     only) store the empty-criteria sentinel hash.
--
-- Keyed by form_id + response_key rather than the DB form uuid: the fullview
-- and every google-forms route already address forms by their Google form_id
-- (text), and response_key is the Google Forms responseId (a stable
-- per-submission id) — see the judge lib for the derivation + hash fallback.
--
-- PII: the stored judgment JSONB carries only 성별/연령/거주지 + fit + reason +
-- flags. Name / phone are sent to the model (for context) but the schema
-- forbids echoing them, so no personal-info value is ever persisted here.
create table public.recruiting_response_judgments (
  id            uuid primary key default gen_random_uuid(),
  form_id       text not null,
  response_key  text not null,
  -- { gender, age_group, region, fit, fit_reason, flags } — model output.
  judgment      jsonb not null,
  -- Stable hash of the criteria the judgment was produced against. Used to
  -- detect condition edits and invalidate the whole form's cache.
  criteria_hash text not null,
  judged_at     timestamptz not null default now(),
  unique (form_id, response_key)
);

-- The incremental route filters by form_id (and reads the whole form's cache
-- in one shot), so a form_id index covers the hot read path.
create index recruiting_response_judgments_form_idx
  on public.recruiting_response_judgments (form_id);

alter table public.recruiting_response_judgments enable row level security;

-- Reads + writes go exclusively through the judgments route's service-role
-- (admin) client, which bypasses RLS. Ownership is already proven there by
-- resolveFormAccess (the same form_id → user_id check the responses route
-- uses) before any judgment is read or written, so a permissive client-facing
-- policy would only widen the surface. We still expose a narrow own-form
-- SELECT so a future client-side reader can fetch its own form's judgments
-- without the service role; there is deliberately no insert/update policy, so
-- authenticated clients can never forge or overwrite a cached judgment.
create policy "recruiting_response_judgments_own_select"
  on public.recruiting_response_judgments
  for select
  using (
    exists (
      select 1
      from public.recruiting_forms f
      where f.form_id = recruiting_response_judgments.form_id
        and f.user_id = auth.uid()
    )
  );
