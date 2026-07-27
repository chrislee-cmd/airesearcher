-- Recruiting-scheduling — project anchor on sched_messages (교차 프로젝트 누출 차단).
--
-- ROOT CAUSE: sched_messages carried no project_id. A "전체 공지" was stored as
-- batch_id=NULL / candidate_id=NULL, and every read OR-ed in
-- `and(candidate_id.is.null,batch_id.is.null)` regardless of project/org — so a
-- global broadcast leaked into EVERY project's chat (and, structurally, across
-- orgs, since org_id was never read either). Service-role reads bypass RLS, so
-- the code filter is the only wall and it was absent.
--
-- FIX (structural): give every message a project anchor, backfilled from its
-- batch (group/전체-of-a-project) or its candidate's batch (private). The read
-- routes then scope broadcasts to `project_id = <viewed project>`, so a message
-- can only surface inside its own project.
--
-- Purely additive — add a nullable FK column + index, then a NULL-only backfill
-- (UPDATE, non-destructive). Auto-applies on merge to main (PROJECT.md §7.5).
--
-- NOTE on the legacy global rows: any pre-existing 전체 broadcast that has no
-- batch_id AND no candidate_id (the leaked global-3) stays project_id=NULL. The
-- read filter (`project_id.eq.X`) therefore EXCLUDES them from every project —
-- the leak is closed by exclusion, no destructive delete required.

alter table public.sched_messages
  add column if not exists project_id uuid
    references public.sched_projects(id) on delete cascade;

create index if not exists sched_messages_project_idx
  on public.sched_messages (project_id);

-- Backfill 1: group / 전체-of-a-project broadcasts carry a batch_id → the batch's
-- project. (A 전체 send targeting a specific tile also stored batch_id here.)
update public.sched_messages m
  set project_id = b.project_id
  from public.sched_batches b
  where m.batch_id = b.id and m.project_id is null and b.project_id is not null;

-- Backfill 2: private threads carry a candidate_id → candidate → batch → project.
update public.sched_messages m
  set project_id = b.project_id
  from public.sched_candidates c
  join public.sched_batches b on b.id = c.batch_id
  where m.candidate_id = c.id and m.project_id is null and b.project_id is not null;
