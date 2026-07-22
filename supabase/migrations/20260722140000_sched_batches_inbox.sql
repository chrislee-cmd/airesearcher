-- Recruiting-scheduling PR-C follow-up — distinguish a project's inbox pool
-- from user-made groups.
--
-- Uploads land candidates in the project's single "inbox" batch (the flat
-- pool), NOT a new group per upload. Groups are formed later by checking
-- candidates in the list and assigning them (그룹으로 보내기), which creates
-- ordinary (is_inbox = false) batches. The group picker lists only those
-- assignment groups; the inbox stays hidden behind the "전체" (all) option.
--
-- Additive only (add column + backfill), so merge auto-apply handles it.

alter table public.sched_batches
  add column if not exists is_inbox boolean not null default false;

-- Mark each project's oldest batch as its inbox pool. After the PR-C backfill
-- there is exactly one batch per project, so this flags all existing batches;
-- the oldest-per-project rule keeps it correct if a project ever has several.
update public.sched_batches b
  set is_inbox = true
  where b.project_id is not null
    and b.id = (
      select b2.id
      from public.sched_batches b2
      where b2.project_id = b.project_id
      order by b2.created_at asc, b2.id asc
      limit 1
    );
