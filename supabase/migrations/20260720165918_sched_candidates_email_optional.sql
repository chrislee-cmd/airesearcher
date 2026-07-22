-- Relax candidate identity (product decision, 2026-07-21): a recruiting
-- candidate may have only a phone, only a name, or neither — email is no longer
-- required. The strict UNIQUE(batch_id,email) is replaced by a partial unique
-- index that only guards email uniqueness WHEN an email is present. Row merge on
-- re-upload now happens in application code by best-available identity
-- (email > phone > name); truly anonymous rows are appended.
alter table public.sched_candidates alter column email drop not null;

alter table public.sched_candidates
  drop constraint if exists sched_candidates_batch_id_email_key;

create unique index if not exists sched_candidates_batch_email_uq
  on public.sched_candidates (batch_id, email)
  where email is not null;
