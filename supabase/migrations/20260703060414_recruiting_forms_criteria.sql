-- Persist the participant-recruitment 조건(criteria) + one-line summary
-- for each published Google Form. Until now these lived only in the
-- wizard's React state (`editedBrief`), so the fullview "참여자 조건"
-- panel went blank the moment the wizard state was gone — after a page
-- refresh, or when viewing any form other than the one just analysed in
-- the current session. The panel is driven by the form *selected* in the
-- responses spreadsheet, which can be any (older) form, so it could never
-- show conditions without a per-form server-side copy.
--
-- Both columns are nullable: (a) form rows published before this feature
-- have no stored criteria, (b) the wizard may publish a survey that was
-- hand-edited without a fresh brief. The UI falls back to the live wizard
-- state when a selected form has no stored criteria, so nothing regresses
-- for same-session publishes even before this migration is applied.
--
-- `criteria` mirrors recruitingBriefSchema.criteria — an array of
-- { category, label, detail, required }. Stored as jsonb so the fullview
-- panel can render the chips verbatim.

alter table public.recruiting_forms
  add column if not exists criteria jsonb,
  add column if not exists summary text;
