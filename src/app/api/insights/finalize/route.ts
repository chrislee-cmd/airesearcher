import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits';
import { extractClusters } from '@/lib/insights-clusters-extract';

// Bumped from 30s for the cluster pass. 230-quote jobs take ~15-25s on
// Sonnet 4.6; the prior 30s ceiling barely cleared per-quote extraction.
export const maxDuration = 60;

// PR 3 threshold (Decision #2 in the scope discussion):
//   success_ratio >= 0.5 → status=ready, no refund
//   success_ratio <  0.5 → status=failed, full refund via credit_refund RPC
//
// "Successful" = the file produced ≥1 row in `insights_quotes` (so it
// reached the persist stage in /files). Zero-yield files (e.g. a slide
// deck with no respondent voice) count against the threshold — the user
// got nothing analytical out of them either, so refunding the batch is
// the user-friendly outcome.
const SUCCESS_THRESHOLD = 0.5;

const JobIdSchema = z.string().uuid();

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobIdParse = JobIdSchema.safeParse(url.searchParams.get('jobId'));
  if (!jobIdParse.success) {
    return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
  }
  const jobId = jobIdParse.data;

  const { data: job, error: jobErr } = await supabase
    .from('insights_jobs')
    .select('id, status, org_id, user_id, file_count')
    .eq('id', jobId)
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  // Idempotent: once a job has reached a terminal state, /finalize is a
  // pure read. The credit_refund RPC is itself idempotent so even a
  // double-finalize on a failed job won't double-credit.
  if (job.status === 'ready' || job.status === 'failed') {
    return NextResponse.json({
      jobId,
      status: job.status,
      idempotent: true,
    });
  }

  const admin = createAdminClient();

  // Server-side truth: count rows directly so a malicious client can't
  // claim more failures than actually happened. distinct(source_file) is
  // the number of files that landed at least one quote.
  const { data: quotes, error: countErr } = await admin
    .from('insights_quotes')
    .select('source_file, participant_name')
    .eq('job_id', jobId);
  if (countErr) {
    return NextResponse.json(
      { error: 'count_failed', detail: countErr.message },
      { status: 500 },
    );
  }

  const sourceFiles = new Set<string>();
  const participants = new Set<string>();
  for (const q of quotes ?? []) {
    if (q.source_file) sourceFiles.add(q.source_file);
    if (q.participant_name) participants.add(q.participant_name);
  }
  const successFiles = sourceFiles.size;
  const fileCount = job.file_count || 0;
  const successRatio = fileCount > 0 ? successFiles / fileCount : 0;

  const nowIso = new Date().toISOString();

  if (successRatio >= SUCCESS_THRESHOLD) {
    const { error: updateErr } = await admin
      .from('insights_jobs')
      .update({
        status: 'ready',
        quote_count: quotes?.length ?? 0,
        participant_count: participants.size,
        updated_at: nowIso,
      })
      .eq('id', jobId);
    if (updateErr) {
      return NextResponse.json(
        { error: 'update_failed', detail: updateErr.message },
        { status: 500 },
      );
    }

    // Cluster extraction (PR 5a). Best-effort: a failed LLM pass should
    // NOT roll back the ready status — quote-level search (PR 7) is the
    // user's #1 priority and is already complete. The viz cards (PR 6a)
    // gracefully degrade to "no clusters" when this table is empty.
    let clusterCount = 0;
    try {
      const { data: clusterQuotes } = await admin
        .from('insights_quotes')
        .select('id, participant_name, theme, text')
        .eq('job_id', jobId);
      if (clusterQuotes && clusterQuotes.length > 0) {
        const clusters = await extractClusters(clusterQuotes);
        if (clusters.length > 0) {
          // Insert clusters first to get their generated uuids, then
          // expand the M:N rows. We could batch with a CTE-style RPC for
          // atomicity, but a soft-fail on the join table is acceptable
          // (worst case: a cluster card shows with empty quote list).
          const clusterRows = clusters.map((c) => ({
            job_id: jobId,
            cluster_key: c.cluster_key,
            label: c.label,
            insight: c.insight,
          }));
          const { data: insertedClusters, error: insertErr } = await admin
            .from('insights_clusters')
            .insert(clusterRows)
            .select('id, cluster_key');
          if (insertErr) throw new Error(`cluster_insert: ${insertErr.message}`);

          const keyToId = new Map(
            (insertedClusters ?? []).map((r) => [r.cluster_key, r.id]),
          );
          const cqRows = clusters.flatMap((c) => {
            const clusterId = keyToId.get(c.cluster_key);
            if (!clusterId) return [];
            return c.quote_ids.map((quoteId) => ({
              cluster_id: clusterId,
              quote_id: quoteId,
            }));
          });
          if (cqRows.length > 0) {
            await admin.from('insights_cluster_quotes').insert(cqRows);
          }
          clusterCount = clusters.length;
        }
      }
    } catch (e) {
      console.error('[insights/finalize] cluster extraction failed', {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Continue — ready status stays.
    }

    return NextResponse.json({
      jobId,
      status: 'ready' as const,
      quote_count: quotes?.length ?? 0,
      participant_count: participants.size,
      cluster_count: clusterCount,
      success_files: successFiles,
      file_count: fileCount,
    });
  }

  // Below threshold → record reason + refund.
  const failureReason = JSON.stringify({
    success_files: successFiles,
    file_count: fileCount,
    success_ratio: Math.round(successRatio * 1000) / 1000,
    threshold: SUCCESS_THRESHOLD,
  });

  const { error: failErr } = await admin
    .from('insights_jobs')
    .update({
      status: 'failed',
      failure_reason: failureReason,
      updated_at: nowIso,
    })
    .eq('id', jobId);
  if (failErr) {
    return NextResponse.json(
      { error: 'update_failed', detail: failErr.message },
      { status: 500 },
    );
  }

  const refund = await refundCredits(
    job.org_id,
    job.user_id,
    'insights_analyzer',
    jobId,
  );

  return NextResponse.json({
    jobId,
    status: 'failed' as const,
    refunded: refund.ok,
    refund_reason: refund.ok ? null : refund.reason,
    success_files: successFiles,
    file_count: fileCount,
  });
}
