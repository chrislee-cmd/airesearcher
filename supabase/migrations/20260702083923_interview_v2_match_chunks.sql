-- Interview V2 search — org/project-scoped pgvector retrieval RPC.
--
-- The existing match_interview_chunks RPC (migration 20260624044302) is
-- scoped to a single interview_job_id — it backs the per-job chat surface.
-- Interview V2 searches across a **project** (or cross-project, org-wide)
-- corpus, so we need a retrieval function that:
--   * scopes by org_id (defense-in-depth; the route calls this via the
--     admin client after verifying getActiveOrg(), mirroring the chat
--     route's "authorize at the boundary, filter in the body" pattern),
--   * optionally narrows to a single interview_documents.project_id,
--   * enforces a cosine-similarity floor server-side so low-relevance
--     chunks never reach the model (hallucination guard, layer 2), and
--   * returns the document filename + project name so the route can build
--     citations without a second round-trip.
--
-- PostgREST can't express `embedding <=> ?::vector ORDER BY distance`, so
-- this is exposed as an RPC exactly like match_interview_chunks.
--
-- SECURITY INVOKER (default): when called with a user-scoped client the
-- interview_chunks RLS policy (has_org_role(org_id,'viewer')) still gates
-- rows. The route uses the admin client for retrieval performance, hence
-- the explicit `c.org_id = p_org_id` predicate below is the actual
-- isolation boundary in that path.
create or replace function public.match_interview_chunks_v2(
  query_embedding vector(1536),
  p_org_id uuid,
  p_project_id uuid default null,
  match_count int default 12,
  score_threshold float default 0.7
)
returns table (
  chunk_id bigint,
  document_id uuid,
  content text,
  metadata jsonb,
  filename text,
  project_id uuid,
  project_name text,
  score float
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    c.metadata,
    d.filename,
    d.project_id,
    p.name as project_name,
    -- `<=>` is cosine *distance*; flip to similarity so the route can
    -- threshold/rank without sign gymnastics. Matches match_interview_chunks.
    1 - (c.embedding <=> query_embedding) as score
  from public.interview_chunks c
  join public.interview_documents d on d.id = c.document_id
  -- interview_documents.project_id may reference either projects or
  -- interview_projects depending on migration order; a LEFT join means a
  -- non-matching / legacy (null) project_id just yields project_name = null
  -- rather than dropping the chunk.
  left join public.interview_projects p on p.id = d.project_id
  where c.org_id = p_org_id
    and (p_project_id is null or d.project_id = p_project_id)
    and 1 - (c.embedding <=> query_embedding) >= score_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
