import { createAdminClient } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits';

// Stale = an active status row that hasn't been touched in this long. Set
// to HARD_DEADLINE_MS (270s) + 90s safety margin so we don't pre-empt jobs
// that are still inside their function deadline but haven't patched yet.
const STALE_THRESHOLD_MS = 6 * 60 * 1000;

const ACTIVE_STATUSES = ['queued', 'expanding', 'crawling', 'summarizing'] as const;

// Called from GET handlers (jobs list / single job) as fire-and-forget. The
// background runner is the canonical place for refund + status flip — this
// helper exists only for the case where the function was SIGKILLed past
// maxDuration and the row froze in an active status.
export async function cleanupStaleDeskJobs(orgId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const { data: stale } = await admin
      .from('desk_jobs')
      .select('id, user_id, status, updated_at')
      .eq('org_id', orgId)
      .in('status', ACTIVE_STATUSES as unknown as string[])
      .lt('updated_at', cutoff);
    if (!stale || stale.length === 0) return 0;
    for (const job of stale) {
      await admin
        .from('desk_jobs')
        .update({
          status: 'error',
          error_message: 'function_timeout_autocleanup',
        })
        .eq('id', job.id);
      // Refund is idempotent — safe even if the runner managed one final
      // refund call before being killed.
      await refundCredits(orgId, job.user_id, 'desk', job.id).catch(() => {});
    }
    return stale.length;
  } catch (err) {
    console.error('[desk-cleanup] failed', err);
    return 0;
  }
}
