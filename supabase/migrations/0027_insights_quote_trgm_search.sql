-- ── insights_quotes — substring (trigram) search ──────────────────────
-- Background: PR #247 wired `websearch_to_tsquery` on the 'simple' tsv
-- config (tokenizes on whitespace + lowercases, no stemming). Manual
-- verification on a 71-quote prod job revealed massive under-recall on
-- Korean — "광고" returned 7 rows because compound/조사 forms like
-- "광고는/광고를/광고에서/신한은행" are stored as single tokens that
-- never match the bare query token. The lossless per-quote search the
-- user named as the #1 priority was effectively broken.
--
-- Fix: pg_trgm GIN indexes back ILIKE substring matching on the three
-- searchable fields. Trigram is language-agnostic — it doesn't need a
-- Korean dictionary, doesn't care about morphology, and is fast on the
-- short snippets quotes carry (median <500 chars). The tsv column from
-- 0025 stays put for any future weighted/operator search (PR 8 chat
-- tools may use it); this PR just adds a parallel substring path that
-- the /api/insights/quotes/search RPC consumes.

create extension if not exists pg_trgm with schema public;

create index if not exists insights_quotes_text_trgm_idx
  on public.insights_quotes using gin (text gin_trgm_ops);

create index if not exists insights_quotes_theme_trgm_idx
  on public.insights_quotes using gin (theme gin_trgm_ops);

create index if not exists insights_quotes_participant_trgm_idx
  on public.insights_quotes using gin (participant_name gin_trgm_ops);

-- ── search RPC ────────────────────────────────────────────────────────
-- security invoker = runs as caller, so the existing org_members RLS
-- policy on insights_quotes scopes results without us re-implementing
-- it here. p_limit is clamped server-side so a hostile client can't
-- request a billion rows. The +1 sentinel for "hasMore" detection is
-- handled in the route (consistent with the previous textSearch shape).

create or replace function public.search_insights_quotes(
  p_job_id uuid,
  p_q text,
  p_cursor bigint default null,
  p_limit int default 50
)
returns table (
  id bigint,
  participant_name text,
  theme text,
  sentiment real,
  text text,
  source_file text,
  source_offset integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    q.id,
    q.participant_name,
    q.theme,
    q.sentiment,
    q.text,
    q.source_file,
    q.source_offset
  from public.insights_quotes q
  where q.job_id = p_job_id
    and (
      q.participant_name ilike '%' || p_q || '%'
      or q.theme ilike '%' || p_q || '%'
      or q.text ilike '%' || p_q || '%'
    )
    and (p_cursor is null or q.id < p_cursor)
  order by q.id desc
  limit least(coalesce(p_limit, 50), 200) + 1;
$$;

grant execute on function public.search_insights_quotes(uuid, text, bigint, int)
  to authenticated;
