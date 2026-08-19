-- insert_interview_chunks — timeout-resilient batch insert for the interview
-- corpus index (incident 2026-08-18).
--
-- Root cause: a 1.43MB / 1031-chunk interview file failed indexing at 570/1031
-- with Postgres `canceling statement due to statement timeout` (57014). Each
-- interview_chunks row is a 1536-d pgvector + an HNSW index update, so a batch
-- insert under DB load can blow the connecting role's default statement_timeout
-- (the admin/service_role write path has no headroom for the HNSW maintenance
-- cost on a large file).
--
-- The route handler already shrinks the batch and retries, but the ceiling it
-- hits — the role's statement_timeout — is not something a PostgREST insert can
-- raise per-statement. This RPC wraps ONLY the chunk insert so we can
-- `set local statement_timeout` for just this write: PostgREST runs each RPC in
-- its own transaction, so SET LOCAL scopes the raised timeout to this insert and
-- no other query inherits it. maxDuration on the route is 300s, so a 30s ceiling
-- leaves ample room for the handler's retry/backoff on top.
--
-- Idempotency is unchanged: the caller inserts chunks in deterministic order and
-- resumes from the already-inserted prefix on re-run (a timed-out statement is
-- cancelled whole → lands zero rows → no partial/duplicate batch). This function
-- adds no dedup of its own; it is a straight insert with a raised timeout.
--
-- Additive only (create function + grant) — no schema/HNSW change, safe to
-- auto-apply on merge (PROJECT.md §7.5).

-- search_path pins `public` (tables) + `extensions` (the pgvector `vector`
-- type — the extension was created without an explicit schema, so on Supabase
-- it lives in `extensions`; a security-definer function must not rely on the
-- caller's search_path, so we name both here or the `::vector` cast fails to
-- resolve).
create or replace function public.insert_interview_chunks(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inserted_count integer;
begin
  -- Raise the per-statement timeout for THIS insert only. SET LOCAL is scoped
  -- to the surrounding (PostgREST-managed) transaction, so it reverts as soon
  -- as this RPC returns.
  set local statement_timeout = '30s';

  insert into public.interview_chunks
    (org_id, interview_job_id, document_id, content, metadata, embedding)
  select
    (e->>'org_id')::uuid,
    (e->>'interview_job_id')::uuid,
    (e->>'document_id')::uuid,
    e->>'content',
    coalesce(e->'metadata', '{}'::jsonb),
    -- embedding arrives as the pgvector literal string "[0.1,0.2,...]".
    (e->>'embedding')::vector
  from jsonb_array_elements(p_rows) as e;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Only the server-internal admin (service_role) path calls this — the route
-- handler verifies org ownership before building the rows. Not granted to
-- authenticated/anon: a security-definer bulk insert must not be client-callable.
revoke all on function public.insert_interview_chunks(jsonb) from public;
grant execute on function public.insert_interview_chunks(jsonb) to service_role;
