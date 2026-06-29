import { createAdminClient } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits';

// Stale = an active status row that hasn't been touched in this long.
// Tightened 6min→3min: LLM hard timeout is 90s/call so any honest live
// runner patches within ~2min between phase transitions. 3min leaves
// breathing room for the slowest synth call (120s) while still freeing
// stuck rows quickly for the next sweep.
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

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
