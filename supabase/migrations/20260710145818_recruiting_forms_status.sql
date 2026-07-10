-- OBS-3 리크루팅 라이프사이클 status FSM.
--
-- Until now recruiting_forms held only the form's Google identity + the
-- analysed 조건/요약 — no lifecycle state. That made the 생성→발행→추출
-- funnel invisible (dashboard "리크루팅 세션 퍼널" row red). A form's life
-- is a small state machine, not a job pipeline, so we model it as a single
-- status column on the existing row instead of a new jobs table
-- (over-engineering the recruiting flow into a queue it never needed).
--
-- States:
--   draft      — reserved for a future server-side draft-save. No current
--                write path produces it (rows are only ever inserted by the
--                publish route), but kept in the enum so the FSM is complete.
--   published  — the Google Form has been created + shared (create route).
--   extracting — persona-fit judging of responses is running (judgments route).
--   extracted  — judging finished for the current response set.
--   error      — an extraction run failed (surfaced so the funnel can count
--                stuck/failed forms distinctly from healthy ones).
--
-- Backfill: every existing recruiting_forms row represents an *already
-- published* Google Form — the only INSERT path is /api/recruiting/google/
-- forms/create, which runs after a successful Forms API publish. Responses
-- live in Google (not this table), so there is no in-DB signal to infer a
-- finer state at migration time. The conservative, data-loss-free backfill
-- is therefore `published` for all existing rows, which the NOT NULL DEFAULT
-- applies automatically. Transitions to extracting/extracted/error accrue
-- from the next judging run onward.
alter table public.recruiting_forms
  add column if not exists status text not null default 'published';

-- Constrain to the five known states. Named so a future migration can drop
-- + re-add it when the enum grows (e.g. an 'invited' state for OBS 초대 계측).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recruiting_forms_status_check'
  ) then
    alter table public.recruiting_forms
      add constraint recruiting_forms_status_check
      check (status in ('draft', 'published', 'extracting', 'extracted', 'error'));
  end if;
end $$;

-- Funnel queries group by status (and often scope by owner/org), so index it.
create index if not exists recruiting_forms_status_idx
  on public.recruiting_forms (status);

-- RLS unchanged: status is written only by the service-role client in the
-- create + judgments routes (ownership already proven before the write), and
-- the existing recruiting_forms_self_update policy already lets an owner patch
-- their own rows. No new policy needed.
