-- journey P0 bridge — provenance column on candidates (GAP-AUDIT §1-7/§1-8).
--
-- Every candidate row now records HOW it entered the roster:
--   'bridge' — auto-ingested from a Google Forms response via the invitation
--              approval hook. Contact (phone/email) is response-derived PII and
--              is server-masked for non-super-admins.
--   'upload' — CSV/XLSX file upload (the user's own data → plaintext).
--   'sheet'  — Google Sheets import (the user's own data → plaintext).
--   NULL     — legacy rows predating this column → treated as plaintext.
--
-- The source-based masking is server-enforced (src/lib/scheduling/
-- candidate-masking.ts); this column is its single source of truth.
--
-- Additive + idempotent (add nullable column with a CHECK that permits NULL) so
-- the merge-to-main auto-apply gate ships it without manual review. Existing
-- rows stay NULL (plaintext) — no backfill guess, since we can't know whether a
-- historical row came from upload or sheet.

alter table public.sched_candidates
  add column if not exists source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sched_candidates_source_check'
  ) then
    alter table public.sched_candidates
      add constraint sched_candidates_source_check
      check (source is null or source in ('bridge', 'upload', 'sheet'));
  end if;
end $$;

create index if not exists sched_candidates_source_idx
  on public.sched_candidates (source);
