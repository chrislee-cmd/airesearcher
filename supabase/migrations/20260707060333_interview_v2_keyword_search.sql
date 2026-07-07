-- Interview V2 search — keyword (trigram) retrieval RPCs for hybrid search.
--
-- The V2 search surface has been pure-vector (match_interview_chunks_v2 /
-- _multi, migration 20260702083923). Pure cosine retrieval structurally
-- misses exact tokens — proper nouns, numbers, brands ("Sephora", "SPF50",
-- "FSA/HSA", "2시간마다") — because a Korean question embedded against an
-- English corpus separates poorly (see the score_threshold note in
-- /api/interviews/v2/search/route.ts: prod cosine tops out ~0.31). Hybrid
-- search (vector ⊕ keyword, fused with RRF in the route) recovers those.
--
-- Why trigram and not tsvector: PROJECT.md §7.13 — `to_tsvector('simple', …)`
-- does whitespace split + lowercase only, no morphology, so "광고" never
-- matches the 조사-combined "광고는/광고를/광고에서". The pg_trgm GIN index on
-- interview_chunks.content already exists (migration 20260629015123) and is
-- language-agnostic; keyword matching here is per-term ILIKE over that index,
-- which is lossless for exact tokens regardless of language.
--
-- Scoring: score = (# of query terms that appear in the chunk) / (# terms),
-- a 0..1 coverage ratio. The route uses the RANK (position) for RRF fusion,
-- not the raw score, but the ratio is returned so formatEvidence can display
-- something meaningful and the route can threshold if needed.
--
-- SECURITY INVOKER (default) + explicit c.org_id = p_org_id predicate — org_id
-- is the isolation boundary when the route retrieves via the admin client
-- after authorizing at the boundary, exactly like the vector RPCs.

-- ── single-project (or whole-org when p_project_id is null) ────────────
create or replace function public.match_interview_chunks_v2_keyword(
  p_org_id uuid,
  p_project_id uuid default null,
  p_terms text[] default '{}',
  match_count int default 12
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
    -- keep only chunks matching at least one term (lossless for exact tokens)
    and exists (
      select 1
      from unnest(p_terms) as t
      where c.content ilike '%' || t || '%'
    )
  order by score desc, c.id asc
  limit greatest(match_count, 1)
$$;

-- ── multi-project (p_project_ids: null/[] ⇒ whole-org) ────────────────
create or replace function public.match_interview_chunks_v2_keyword_multi(
  p_org_id uuid,
  p_project_ids uuid[] default null,
  p_terms text[] default '{}',
  match_count int default 12
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
    and (
      -- null or [] ⇒ no project narrowing (whole-org "all projects")
      array_length(p_project_ids, 1) is null
      or d.project_id = any(p_project_ids)
    )
    and exists (
      select 1
      from unnest(p_terms) as t
      where c.content ilike '%' || t || '%'
    )
  order by score desc, c.id asc
  limit greatest(match_count, 1)
$$;
