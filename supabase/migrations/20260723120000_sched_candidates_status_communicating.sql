-- Add the '소통중'(communicating) candidate status alongside pending/confirmed
-- (recsched 항목4). sched_candidates.status is a free-text column today (no CHECK)
-- with real values 'pending'/'confirmed'; this adds a CHECK to keep the domain
-- honest now that a third value exists. Additive + idempotent: existing rows are
-- all pending/confirmed so the constraint validates cleanly, and the guard makes
-- re-runs safe. No default/type change (auto-apply gate = additive, §7.5).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sched_candidates_status_check'
      and conrelid = 'public.sched_candidates'::regclass
  ) then
    alter table public.sched_candidates
      add constraint sched_candidates_status_check
      check (status in ('pending', 'confirmed', 'communicating'));
  end if;
end $$;
