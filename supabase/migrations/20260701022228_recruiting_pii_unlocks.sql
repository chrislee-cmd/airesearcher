-- recruiting_pii_unlocks — audit / billing log for the fullview PII unlock
-- feature. Each row records one paid unlock (5 credits) of a single
-- respondent's personal-info cells in the recruiting fullview spreadsheet.
--
-- This table is the authoritative audit trail; the unlock itself is
-- session-scoped on the client (in-memory, re-locks on tab close), so we do
-- NOT read this table to auto-reveal on revisit — it exists purely for
-- billing reconciliation and abuse investigation. A future spec
-- (recruiting-pii-unlock-persist-24h) may promote it to a persistence source.
create table public.recruiting_pii_unlocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  form_id     text not null,
  row_id      text not null,
  cost        int  not null default 5,
  unlocked_at timestamptz not null default now()
);

create index recruiting_pii_unlocks_user_form_idx
  on public.recruiting_pii_unlocks (user_id, form_id, unlocked_at desc);

alter table public.recruiting_pii_unlocks enable row level security;

-- Users can read their own unlock history. Inserts happen only through the
-- unlock route's service-role (admin) client, which bypasses RLS — there is
-- deliberately no insert policy, so authenticated clients cannot forge log
-- rows to fake a paid unlock.
create policy "recruiting_pii_unlocks_own_select"
  on public.recruiting_pii_unlocks
  for select
  using (user_id = auth.uid());
