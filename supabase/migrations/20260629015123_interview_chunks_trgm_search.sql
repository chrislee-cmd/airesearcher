-- ── interview_chunks — substring (trigram) search ────────────────────
-- The interview corpus already has embedding-based retrieval (the chat
-- surface in /api/interviews/chat → match_interview_chunks RPC). For
-- the new full-view search panel we want a separate, lower-latency,
-- language-agnostic substring path that does not depend on the OpenAI
-- embedding round-trip — users typing keywords ("광고", "재구매") want
-- immediate, lossless recall over the indexed chunks.
--
-- 'simple' tsv config is unusable for Korean per PROJECT.md §7.13
-- (compound/조사 forms — "광고는/광고를/광고에서" — never match the bare
-- token because there's no morphology). Trigram GIN is language-agnostic
-- and was already adopted for insights_quotes in migration 0027 with the
-- same rationale; here we apply the same pattern to interview_chunks.

create extension if not exists pg_trgm with schema public;

create index if not exists interview_chunks_content_trgm_idx
  on public.interview_chunks using gin (content gin_trgm_ops);

-- ── search RPC ────────────────────────────────────────────────────────
-- security invoker = runs as caller, so the RLS policies on
-- interview_chunks (ic_select_member from 20260624123016) scope results
-- without us re-implementing org gating here. p_limit is clamped so a
-- hostile client can't request a billion rows. Results are ordered by
-- chunk id ascending so they map back to document/heading order.

create or replace function public.search_interview_chunks(
  p_job_id uuid,
  p_q text,
  p_limit int default 50
)
returns table (
  chunk_id bigint,
  document_id uuid,
  content text,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    c.metadata
  from public.interview_chunks c
  where c.interview_job_id = p_job_id
    and c.content ilike '%' || p_q || '%'
  order by c.id asc
  limit least(coalesce(p_limit, 50), 200);
$$;

grant execute on function public.search_interview_chunks(uuid, text, int)
  to authenticated;
