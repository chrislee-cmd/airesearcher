-- 0026_insights_realtime_publication.sql
--
-- Wire `insights_jobs` into the Supabase Realtime publication so the
-- `/insights-analyzer` dashboard can subscribe to FSM transitions
-- (pending → converting → extracting → ready/failed) as they happen.
--
-- Without this, the table is still queryable via REST/postgrest, but
-- `postgres_changes` events are silently dropped by the Realtime broker.
-- Symptom we hit on PR #243's preview: the status pill stayed on "대기 중"
-- for the full LLM-extraction window (~3-4 minutes) even though the DB
-- row had already advanced to `extracting`.
--
-- `insights_quotes` intentionally stays out of the publication — the
-- /insights-analyzer page polls its count every 2s instead. Each quote
-- INSERT would otherwise fire one event (50-150 per file × N files),
-- swamping the WebSocket for a counter that only needs ~1Hz precision.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'insights_jobs'
  ) then
    alter publication supabase_realtime add table public.insights_jobs;
  end if;
end $$;
