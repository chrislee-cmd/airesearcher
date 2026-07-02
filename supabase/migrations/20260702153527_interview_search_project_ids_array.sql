-- Interview V2 search — cross-project (project_ids array) retrieval RPC.
--
-- The existing match_interview_chunks_v2 (migration 20260702083923) takes a
-- single p_project_id: null ⇒ whole-org, uuid ⇒ that one project. The V2
-- search UI now has a multi-select project picker (PR #631 scope toggle
-- follow-up), so retrieval must scope to an arbitrary set of projects.
--
-- Rather than change the single-project signature (which the backward-compat
-- path still calls), this adds a sibling _multi variant taking uuid[]. Both
-- functions return the identical row shape so the route/lib map either result
-- with the same code.
--
-- p_project_ids semantics (mirrors the route's project_ids field):
--   null           ⇒ whole-org (defensive; shares the empty-array branch)
--   {} (empty)     ⇒ whole-org — "all projects"
--   {id1, id2,...} ⇒ only documents in those projects
--
-- NOTE array_length('{}'::uuid[], 1) and array_length(null, 1) both return
-- NULL, so the `array_length(...) is null` test covers both null and [].
--
-- SECURITY INVOKER (default) + explicit c.org_id = p_org_id predicate, exactly
-- like match_interview_chunks_v2 — org_id is the isolation boundary when the
-- route retrieves via the admin client after authorizing at the boundary.
create or replace function public.match_interview_chunks_v2_multi(
  query_embedding vector(1536),
  p_org_id uuid,
  p_project_ids uuid[] default null,
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
    1 - (c.embedding <=> query_embedding) as score
  from public.interview_chunks c
  join public.interview_documents d on d.id = c.document_id
  left join public.interview_projects p on p.id = d.project_id
  where c.org_id = p_org_id
    and (
      -- null or [] ⇒ no project narrowing (whole-org "all projects")
      array_length(p_project_ids, 1) is null
      -- otherwise restrict to the selected set
      or d.project_id = any(p_project_ids)
    )
    and 1 - (c.embedding <=> query_embedding) >= score_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
