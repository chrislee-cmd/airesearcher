import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { refundCredits } from '@/lib/credits';

// 60s without a progress patch is a strong signal the runner is dead
// (SIGKILLed past maxDuration). In that case cooperative cancel never
// fires — we have to force-flip the row and refund directly.
const STALE_MS = 60_000;

// POST /api/desk/jobs/[id]/cancel — cooperative cancel for a live runner
// (flips cancel_requested, runner exits at next checkpoint), OR a hard
// stop with immediate refund when the row looks dead. Idempotent.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // RLS will reject non-members; explicit org_id filter is a belt-and-braces
  // guard so a stray id from another org can't be cancelled.
  const { data: job, error: fetchErr } = await supabase
    .from('desk_jobs')
    .select('id, status, updated_at, user_id')
    .eq('id', id)
    .eq('org_id', org.org_id)
    .single();
  if (fetchErr || !job) {
    return NextResponse.json({ error: fetchErr?.message ?? 'not_found' }, { status: 404 });
  }
  if (['done', 'error', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ ok: true, already: true, status: job.status });
  }

  const updatedAt = new Date(job.updated_at).getTime();
  const looksDead = Date.now() - updatedAt > STALE_MS;

  if (looksDead) {
    // Hard stop — the runner hasn't patched in 60s+, treat as SIGKILLed.
    // Flip status + refund directly so the user doesn't keep staring.
    const admin = createAdminClient();
    await admin
      .from('desk_jobs')
      .update({
        status: 'error',
        error_message: 'cancelled_after_timeout',
      })
      .eq('id', id);
    await refundCredits(org.org_id, job.user_id, 'desk', id).catch(() => {});
    return NextResponse.json({ ok: true, forced: true });
  }

  // Cooperative cancel — runner is alive and will pick up the flag at the
  // next checkpoint, then finalize as 'cancelled' with refund.
  const { error: updErr } = await supabase
    .from('desk_jobs')
    .update({ cancel_requested: true })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
