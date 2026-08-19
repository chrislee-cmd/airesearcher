// Timeout-resilient chunk insert for the interview corpus index.
//
// Shared by the two insert paths — POST /api/interviews/index (upload) and
// POST /api/interviews/index/run-now (manual re-index) — so their resilience
// stays in lockstep. Prod incidents 2026-07-13 + 2026-08-18: `chunk_insert_failed`,
// root cause = Postgres `canceling statement due to statement timeout` (57014)
// on the chunk insert. Each interview_chunks row is a 1536-d pgvector + an HNSW
// index update, so a batch under DB load/contention blows the role's default
// statement_timeout. The 2026-08-18 case was extreme: a 1.43MB / 1031-chunk file
// failed at 570/1031 every time, dropping 63 respondents from the analysis.
//
// Two axes live here:
//   1) adaptive batch size (rowsPerInsertFor) → the more chunks a file has, the
//      smaller each insert, so per-statement HNSW work stays under the timeout.
//   2) raised statement_timeout + retry (insertInterviewChunks) → the write goes
//      through the insert_interview_chunks RPC, which `SET LOCAL statement_timeout`
//      so the insert has headroom the default role timeout doesn't give, and a
//      transient timeout/contention blip is absorbed by exponential-backoff retry
//      instead of failing the whole job.
//
// The insert is idempotent to retry: a timed-out statement is cancelled whole
// (zero rows land), so a retry — or a resume on a later run — can't double-insert.

import type { PostgrestError } from '@supabase/supabase-js';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

const CHUNK_INSERT_MAX_ATTEMPTS = 5;
const CHUNK_INSERT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

// Transient DB errors worth retrying — statement timeout (57014), plus a few
// contention/availability classes that clear on a short backoff. Constraint
// violations (23xxx) and the like are permanent, so we let them throw straight
// away rather than burning attempts on a guaranteed failure.
const RETRYABLE_PG_CODES = new Set([
  '57014', // statement_timeout / canceling statement
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '08006', // connection_failure
  '08003', // connection_does_not_exist
  'XX000', // internal_error (seen on transient pooler blips)
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePgError(err: PostgrestError | null): boolean {
  if (!err) return false;
  if (err.code && RETRYABLE_PG_CODES.has(err.code)) return true;
  // Some pooler/timeout surfaces arrive without a stable code — fall back to
  // the message text for the statement-timeout signal specifically.
  return /statement timeout|canceling statement/i.test(err.message ?? '');
}

// Compact, log-free-diagnosable error string: cause + real PG code/message so
// interview_jobs.error_message (OBS-4) and the failure-alert email (#1008)
// carry the actual reason instead of a bare `chunk_insert_failed`.
function describePgError(prefix: string, err: PostgrestError): string {
  const parts = [err.message];
  if (err.code) parts.push(`(${err.code})`);
  return `${prefix}: ${parts.filter(Boolean).join(' ')}`;
}

// Rows per insert statement, adaptive on the file's chunk count. Large files
// accumulate DB load, so we shrink the batch to keep each statement's HNSW
// maintenance under the (raised) statement_timeout. Small files keep the fast
// 30-row batches — no speed regression where it isn't needed.
export function rowsPerInsertFor(totalChunks: number): number {
  if (totalChunks > 800) return 8;
  if (totalChunks > 500) return 10;
  return 30;
}

export type InterviewChunkInsertRow = {
  org_id: string;
  interview_job_id: string;
  document_id: string;
  content: string;
  metadata: unknown;
  // Pre-formatted pgvector literal "[0.1,0.2,...]" — the RPC casts it to vector.
  embedding: string;
};

/**
 * Insert one batch of interview chunks through the insert_interview_chunks RPC
 * (which raises statement_timeout for just this write), retrying transient
 * timeouts/contention with exponential backoff. Throws a self-describing
 * `chunk_insert_failed: <message> (<code>)` on give-up so the caller can stamp
 * interview_jobs.error_message with the real cause. The partially-inserted
 * chunks of earlier batches stay put (deterministic order) so a re-run resumes
 * exactly where it stopped.
 */
export async function insertInterviewChunks(
  admin: AdminClient,
  rows: InterviewChunkInsertRow[],
): Promise<void> {
  let chunkErr: PostgrestError | null = null;
  for (let attempt = 0; attempt < CHUNK_INSERT_MAX_ATTEMPTS; attempt++) {
    const { error } = await admin.rpc('insert_interview_chunks', {
      p_rows: rows,
    });
    chunkErr = error;
    if (!error) return;
    const willRetry =
      attempt < CHUNK_INSERT_MAX_ATTEMPTS - 1 && isRetryablePgError(error);
    console.error(
      `[interviews/index] chunk insert failed (attempt ${attempt + 1}/${CHUNK_INSERT_MAX_ATTEMPTS}, ${willRetry ? 'retrying' : 'giving up'})`,
      error,
    );
    if (!willRetry) break;
    await sleep(CHUNK_INSERT_BACKOFF_MS[attempt]);
  }
  // chunkErr is non-null here — the loop only exits via `return` on success.
  throw new Error(describePgError('chunk_insert_failed', chunkErr!));
}
