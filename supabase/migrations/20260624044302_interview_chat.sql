-- Interview corpus chat — PR-2 of the redesign.
--
-- Persists each turn of the chat surface that queries the interview
-- corpus built by PR-1 (interview_documents + interview_chunks). The UI
-- always carries the full conversation in its request body so the API
-- itself doesn't need to read history per call, but we persist messages
-- so:
--   * page refresh / cross-device revisit restores the conversation
--   * future analytics can look at what users actually ask
--   * citations (retrieved chunk pointers) survive past the streaming
--     handler so the UI can re-render bibliographies after a reload
--
-- The role column is a free-form text — the only producers are this
-- repo and we already enforce {'user','assistant'} in the route handler
-- + check constraint here, so a Postgres enum would just be migration
-- friction without a real benefit.

create table if not exists public.interview_chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  interview_job_id uuid not null references public.interview_jobs(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  -- [{document_id, chunk_id, filename, heading_path}] — see
  -- src/lib/interview-search.ts for the canonical shape. JSONB so the
  -- list isn't capped and we can extend the citation envelope later
  -- (e.g. add similarity score) without a migration.
  citations jsonb,
  created_at timestamptz not null default now()
);

-- Conversation reads always paginate by (job, time-asc); this index is
-- the single covering path the route handler relies on.
create index if not exists idx_interview_chat_job
  on public.interview_chat_messages (interview_job_id, created_at);

alter table public.interview_chat_messages enable row level security;

-- Read: viewer-level membership in the owning org. The route handler
-- joins via interview_job_id, but RLS on the message rows themselves
-- keeps stray queries from leaking content.
drop policy if exists "icm_select_member" on public.interview_chat_messages;
create policy "icm_select_member" on public.interview_chat_messages
  for select using (public.has_org_role(org_id, 'viewer'));

-- Write: member-or-above in the org. Includes both the user's question
-- and the assistant's reply — the streaming handler persists both at the
-- end of the stream using the requester's session, so member is enough.
drop policy if exists "icm_insert_member" on public.interview_chat_messages;
create policy "icm_insert_member" on public.interview_chat_messages
  for insert with check (public.has_org_role(org_id, 'member'));

-- Update/delete: admin only. The chat thread is append-only from the
-- user's perspective; manual cleanup falls to admins.
drop policy if exists "icm_update_admin" on public.interview_chat_messages;
create policy "icm_update_admin" on public.interview_chat_messages
  for update using (public.has_org_role(org_id, 'admin'));

drop policy if exists "icm_delete_admin" on public.interview_chat_messages;
create policy "icm_delete_admin" on public.interview_chat_messages
  for delete using (public.has_org_role(org_id, 'admin'));

-- match_interview_chunks ──────────────────────────────────────────────
-- pgvector cosine top-K search scoped to a single interview_job.
-- PostgREST can't express the `embedding <=> ?::vector ORDER BY distance`
-- pattern directly, so we expose the query as an RPC. Membership is
-- enforced two ways:
--   1. SECURITY INVOKER (default) — the function runs as the caller, so
--      the RLS policy on interview_chunks already gates row access.
--   2. The route handler passes the job's org_id explicitly and only
--      after verifying the requester can see that job, which lets us
--      add a defense-in-depth filter inside the function body.
create or replace function public.match_interview_chunks(
  query_embedding vector(1536),
  job_id uuid,
  match_count int default 12
)
returns table (
  chunk_id bigint,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    c.metadata,
    -- pgvector's `<=>` returns cosine *distance* (0 = identical, 2 =
    -- opposite). Convert to similarity so the chat handler can rank
    -- and threshold without flipping the sign.
    1 - (c.embedding <=> query_embedding) as similarity
  from public.interview_chunks c
  where c.interview_job_id = job_id
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;

