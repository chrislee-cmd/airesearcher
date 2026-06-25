-- probing_suggestions — persist each suggest stream result so the probing
-- widget can show accumulated history across refreshes / devices.
--
-- Prior policy (PR-1/PR-2): suggestions were React state only (휘발성) and
-- vanished on page refresh / session restart. The widget now POSTs after
-- each completed stream and GETs the most recent rows on mount.
--
-- One row = one suggest() call result (3~5 questions). suggestion_set is
-- JSONB so the question array doesn't need a child table and the per-
-- question shape can evolve without further migration.

create table if not exists public.probing_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- canonical shape: { questions: [{ text, technique, why }, ...] }
  suggestion_set jsonb not null,
  -- snippet of the transcript window the stream consumed. optional —
  -- useful for debugging or future search but no UI surface today.
  transcript_cutoff text,
  created_at timestamptz not null default now()
);

-- list-by-user-recent is the only read pattern; user_id leads since RLS
-- gates by user_id and the API filters by user implicitly.
create index if not exists probing_suggestions_user_created_idx
  on public.probing_suggestions (user_id, created_at desc);

alter table public.probing_suggestions enable row level security;

-- own-user only. Probing reflects the personal session of one interviewer
-- and isn't shared org-wide. Matches the spec's "본인 org 의 본인 user 만
-- read/write" decision. The insert policy additionally requires org
-- membership to keep cross-org writes impossible even with a forged
-- payload.
drop policy if exists "probing_suggestions_own_select" on public.probing_suggestions;
create policy "probing_suggestions_own_select" on public.probing_suggestions
  for select using (user_id = auth.uid());

drop policy if exists "probing_suggestions_own_insert" on public.probing_suggestions;
create policy "probing_suggestions_own_insert" on public.probing_suggestions
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

drop policy if exists "probing_suggestions_own_delete" on public.probing_suggestions;
create policy "probing_suggestions_own_delete" on public.probing_suggestions
  for delete using (user_id = auth.uid());
