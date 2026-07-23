-- Recruiting-scheduling PR-C follow-up — a project-level shared link.
--
-- The share link used to be per-candidate (sched_candidates.participant_token,
-- one unguessable URL per person). The redesign (BUILD-SPEC §5.1) switches to
-- ONE common link per project: /schedule/<share_token>. Identity is no longer
-- carried by the URL — the visitor proves who they are with the last 6 digits
-- of their phone once inside (see participant-gate). So share_token only needs
-- to identify the project (unguessable uuid); it is NOT a secret that grants
-- access to any one person's data.
--
-- Fully additive: add a nullable column with a uuid default, backfill existing
-- rows, then a unique index. No drop/rename/type-change, so the merge-to-main
-- auto-apply handles it. The per-candidate participant_token column is left in
-- place (unused now, dropped separately — dropping it here would be destructive).

alter table public.sched_projects
  add column if not exists share_token text default gen_random_uuid()::text;

-- Backfill any pre-existing rows that predate the column (idempotent).
update public.sched_projects
  set share_token = gen_random_uuid()::text
  where share_token is null;

create unique index if not exists sched_projects_share_token_idx
  on public.sched_projects (share_token);
