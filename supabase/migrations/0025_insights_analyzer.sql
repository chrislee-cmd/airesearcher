-- 0025_insights_analyzer.sql
--
-- Insights Analyzer (인사이트 분석기) — schema foundation.
--
-- The merged 인터뷰 결과 / 전체 리포트 surface ingests a batch of files,
-- normalizes them to markdown, then extracts (a) a lossless quote store,
-- (b) per-viz analytical schemas (clusters / tensions / contradictions),
-- and (c) a per-job chat conversation. Everything below cascade-deletes
-- from `insights_jobs` so a single job teardown wipes the whole surface.
--
-- Design decisions baked in (so future readers can trace why):
--   • Unified `insights_jobs` row per upload — atomic FSM, partial-failure
--     clarity (vs. join-table-per-step that would leave dangling partial
--     state on extractor crashes).
--   • Quote-level granularity (`insights_quotes`) — per-quote search is
--     the stated #1 UX priority; FTS GIN index ships day 1 so the chat
--     agent's primary tool is fast from the first job.
--   • Per-viz tables (clusters / tensions / contradictions) instead of a
--     single `insights_jobs.viz_payload jsonb` — keeps RLS, indexes, and
--     foreign keys to quotes tight, and lets the viz layer subscribe to
--     just the slice it renders via realtime.
--   • RLS mirrors voice_sessions (0023) / desk_jobs (0006): SELECT by
--     org membership; INSERT/UPDATE service-role-only except chat user
--     messages. Same threat model — forged rows could poison the chat
--     agent's tool context or backfill fake usage.

-- ── insights_jobs ────────────────────────────────────────────────────────
create table public.insights_jobs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  user_id           uuid not null references auth.users(id),

  -- Finite state machine. The /api/insights/* routes (PR 3+) walk rows
  -- through these states; the dashboard subscribes via Supabase realtime.
  --   pending     — row created, files queued
  --   converting  — inputs being normalized to .md
  --   extracting  — quotes / themes being pulled by LLM
  --   analyzing   — viz schemas (clusters/tensions/contradictions) building
  --   ready       — dashboard renderable + chat enabled
  --   failed      — see failure_reason
  status            text not null default 'pending'
                    check (status in ('pending','converting','extracting','analyzing','ready','failed')),
  failure_reason    text,

  -- Snapshot metadata for the dashboard header. file_count is the count
  -- of inputs uploaded; participant_count / quote_count are backfilled
  -- after extraction succeeds and drive the dashboard header pills.
  file_count        integer not null default 0,
  participant_count integer not null default 0,
  quote_count       integer not null default 0,

  title             text,
  locale            text not null default 'ko',

  -- Cumulative credits charged for this job. The cost target is 30
  -- credits per features.ts; PR 3+ will wire the charge at the
  -- /api/insights/start boundary.
  credits_charged   integer not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index insights_jobs_org_idx
  on public.insights_jobs (org_id, created_at desc);

alter table public.insights_jobs enable row level security;

create policy "insights_jobs_org_select"
on public.insights_jobs for select
using (
  exists (
    select 1 from public.organization_members m
    where m.org_id = insights_jobs.org_id
      and m.user_id = auth.uid()
  )
);
-- INSERT/UPDATE intentionally have no client policy. /api/insights/*
-- writes via service-role, mirroring voice_sessions (0023) and
-- translate_messages (0022).

-- ── insights_quotes ─────────────────────────────────────────────────────
-- Lossless quote store. Every distinct utterance the extractor produces
-- becomes a row here. The chat agent (PR 8) uses FTS over this table as
-- its primary tool — per-quote search is the user's stated #1 priority.
create table public.insights_quotes (
  id                bigint generated always as identity primary key,
  job_id            uuid not null references public.insights_jobs(id) on delete cascade,

  participant_name  text not null,
  -- Free-text theme key. The v2 viz reference uses 9 (routine / product /
  -- channel / info / texture / pain / ingredient / eco / future); leaving
  -- this open lets non-skincare domains carry their own taxonomy.
  theme             text,
  -- 0.0 (negative) ~ 1.0 (positive). NULL when the extractor declines
  -- to score — the matrix/heatmap viz renders NULL cells as neutral.
  sentiment         real check (sentiment is null or (sentiment >= 0 and sentiment <= 1)),

  text              text not null,
  source_file       text,
  source_offset     integer,

  -- Generated tsvector for FTS. 'simple' config (no stemming) because
  -- data is mixed ko/en — language-specific dictionaries would silently
  -- drop the other language's recall. pgroonga / per-locale configs are
  -- a PR 7 follow-up if recall feels lossy in practice.
  tsv               tsvector
                    generated always as (
                      setweight(to_tsvector('simple', coalesce(participant_name,'')), 'A') ||
                      setweight(to_tsvector('simple', coalesce(theme,'')),            'B') ||
                      setweight(to_tsvector('simple', coalesce(text,'')),             'C')
                    ) stored,

  created_at        timestamptz not null default now()
);

create index insights_quotes_job_idx
  on public.insights_quotes (job_id);
create index insights_quotes_tsv_idx
  on public.insights_quotes using gin (tsv);
-- Per-participant lookups are the second hottest path (matrix row,
-- journey row, chat "show me everything {name} said"). Btree composite.
create index insights_quotes_participant_idx
  on public.insights_quotes (job_id, participant_name);

alter table public.insights_quotes enable row level security;

create policy "insights_quotes_org_select"
on public.insights_quotes for select
using (
  exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_quotes.job_id
  )
);

-- ── insights_clusters + insights_cluster_quotes ─────────────────────────
-- QuoteConstellation viz. ~5 quote clusters per job, each with an insight
-- line; M:N to quotes because a quote can appear in multiple clusters
-- with different weights/rationales.
create table public.insights_clusters (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.insights_jobs(id) on delete cascade,
  -- Short id assigned by the LLM (e.g. 'white-cast') — unique per job,
  -- not globally. Stable handle for the viz across re-renders.
  cluster_key text not null,
  label       text not null,
  color       text,
  insight     text,
  unique (job_id, cluster_key)
);
create index insights_clusters_job_idx on public.insights_clusters (job_id);

alter table public.insights_clusters enable row level security;
create policy "insights_clusters_org_select"
on public.insights_clusters for select
using (
  exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_clusters.job_id
  )
);

create table public.insights_cluster_quotes (
  cluster_id  uuid not null references public.insights_clusters(id) on delete cascade,
  quote_id    bigint not null references public.insights_quotes(id) on delete cascade,
  -- Membership weight 0..1 — drives node size / opacity in constellation.
  weight      real default 1.0 check (weight >= 0 and weight <= 1),
  -- LLM rationale: "why this quote sits in this cluster". Drives the
  -- detail panel copy in the viz.
  rationale   text,
  primary key (cluster_id, quote_id)
);

alter table public.insights_cluster_quotes enable row level security;
create policy "insights_cluster_quotes_org_select"
on public.insights_cluster_quotes for select
using (
  exists (
    select 1
    from public.insights_clusters c
    join public.insights_jobs j on j.id = c.job_id
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where c.id = insights_cluster_quotes.cluster_id
  )
);

-- ── insights_tensions ───────────────────────────────────────────────────
-- TensionMap viz. Per (participant, axis) pair: lo / hi values on 0..1
-- plus the quote anchoring each side. Tension strength = |hi - lo| is
-- derived on the client (no need to store the redundant scalar).
create table public.insights_tensions (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.insights_jobs(id) on delete cascade,
  participant_name  text not null,
  -- v2 reference uses 'healthBeauty' / 'routineEffort' / 'trustPrice' /
  -- 'loyaltySearch'; free text so non-skincare jobs carry their own.
  axis              text not null,
  lo_val            real not null check (lo_val >= 0 and lo_val <= 1),
  hi_val            real not null check (hi_val >= 0 and hi_val <= 1),
  -- on delete set null (not cascade): we keep the tension row even if a
  -- quote is later pruned, so the viz still shows the axis with a
  -- missing anchor rather than disappearing silently.
  lo_quote_id       bigint references public.insights_quotes(id) on delete set null,
  hi_quote_id       bigint references public.insights_quotes(id) on delete set null,
  unique (job_id, participant_name, axis)
);
create index insights_tensions_job_idx on public.insights_tensions (job_id);

alter table public.insights_tensions enable row level security;
create policy "insights_tensions_org_select"
on public.insights_tensions for select
using (
  exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_tensions.job_id
  )
);

-- ── insights_contradictions ─────────────────────────────────────────────
-- ContradictionBoard viz. ~8 pairs per job: type / strength plus two
-- counterposed quotes and an insight line.
create table public.insights_contradictions (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.insights_jobs(id) on delete cascade,
  participant_name    text not null,
  -- v2 reference uses '말vs행동' / '의식vs무의식' / '이상vs현실'; free
  -- text so a non-Korean dataset can supply its own labels.
  contradiction_type  text not null,
  strength            text check (strength in ('high','medium','low')),
  label               text not null,
  a_label             text,
  a_quote_id          bigint references public.insights_quotes(id) on delete set null,
  b_label             text,
  b_quote_id          bigint references public.insights_quotes(id) on delete set null,
  insight             text,
  tag                 text
);
create index insights_contradictions_job_idx on public.insights_contradictions (job_id);

alter table public.insights_contradictions enable row level security;
create policy "insights_contradictions_org_select"
on public.insights_contradictions for select
using (
  exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_contradictions.job_id
  )
);

-- ── insights_chat_messages ──────────────────────────────────────────────
-- Per-job chat history (Decision 10: B = job-scoped, not global). User
-- INSERT is allowed (the user authoring their own turn); assistant and
-- tool rows go via service-role from /api/insights/chat (PR 8) so the
-- model can't be tricked into "remembering" forged context.
create table public.insights_chat_messages (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.insights_jobs(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool')),
  text        text not null,
  -- For role='tool': { name, arguments, result } payload. For user /
  -- assistant rows: NULL (or future structured citation payload
  -- pointing to quote ids the assistant grounded on).
  meta        jsonb,
  ts          timestamptz not null default now()
);
create index insights_chat_messages_job_idx
  on public.insights_chat_messages (job_id, ts);

alter table public.insights_chat_messages enable row level security;

create policy "insights_chat_messages_org_select"
on public.insights_chat_messages for select
using (
  exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_chat_messages.job_id
  )
);

create policy "insights_chat_messages_user_insert"
on public.insights_chat_messages for insert
with check (
  role = 'user'
  and exists (
    select 1
    from public.insights_jobs j
    join public.organization_members m
      on m.org_id = j.org_id and m.user_id = auth.uid()
    where j.id = insights_chat_messages.job_id
  )
);
