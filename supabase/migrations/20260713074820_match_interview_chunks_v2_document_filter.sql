-- Interview V2 search — single-document scope filter on the retrieval RPCs.
--
-- The file-detail card (file-card.tsx) adds a per-file LLM search: "search
-- inside this one document". The existing V2 search RPCs scope by org and
-- (optionally) project, but there is no single-document scope. This migration
-- adds an optional `p_document_id uuid default null` parameter to the two
-- single-project retrieval functions the route reaches through hybridSearch:
--
--   * match_interview_chunks_v2          (vector / pgvector cosine)
--   * match_interview_chunks_v2_keyword  (keyword / pg_trgm ILIKE)
--
-- The route runs BOTH halves and fuses them (RRF). Filtering only the vector
-- half would leak other-file chunks through the keyword half, breaking scope
-- isolation — so both single-project RPCs gain the same filter. The _multi
-- RPCs are untouched (single-file search is always single-project).
--
-- Backward compat: p_document_id defaults null ⇒ `(p_document_id is null or
-- c.document_id = p_document_id)` is a no-op, so every existing project /
-- whole-org call behaves exactly as before (regression 0).
--
-- Overload safety (Postgres footgun): `create or replace` matches by
-- argument-type signature. Appending a parameter yields a DIFFERENT signature,
-- so a bare replace would leave the old 5-arg / 4-arg function in place
-- alongside the new one — and a call with the original named args then
-- resolves ambiguously ("function is not unique"). We therefore drop the old
-- signatures first, then recreate. `drop function if exists` is idempotent, so
-- re-running this migration is safe.

-- ── vector (cosine) single-project RPC ────────────────────────────────
drop function if exists public.match_interview_chunks_v2(
  vector(1536), uuid, uuid, int, float
);

create or replace function public.match_interview_chunks_v2(
  query_embedding vector(1536),
  p_org_id uuid,
  p_project_id uuid default null,
  match_count int default 12,
  score_threshold float default 0.7,
  p_document_id uuid default null
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
    and (p_project_id is null or d.project_id = p_project_id)
    -- single-document narrowing — no-op when null (backward compat)
    and (p_document_id is null or c.document_id = p_document_id)
    and 1 - (c.embedding <=> query_embedding) >= score_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;

-- ── keyword (trigram ILIKE) single-project RPC ────────────────────────
drop function if exists public.match_interview_chunks_v2_keyword(
  uuid, uuid, text[], int
);

create or replace function public.match_interview_chunks_v2_keyword(
  p_org_id uuid,
  p_project_id uuid default null,
  p_terms text[] default '{}',
  match_count int default 12,
  p_document_id uuid default null
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
    (
      select count(*)
      from unnest(p_terms) as t
      where c.content ilike '%' || t || '%'
    )::float / greatest(coalesce(array_length(p_terms, 1), 0), 1) as score
  from public.interview_chunks c
  join public.interview_documents d on d.id = c.document_id
  left join public.interview_projects p on p.id = d.project_id
  where c.org_id = p_org_id
    and (p_project_id is null or d.project_id = p_project_id)
    -- single-document narrowing — no-op when null (backward compat)
    and (p_document_id is null or c.document_id = p_document_id)
    and exists (
      select 1
      from unnest(p_terms) as t
      where c.content ilike '%' || t || '%'
    )
  order by score desc, c.id asc
  limit greatest(match_count, 1)
$$;
