import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { refundCredits } from '@/lib/credits';

// POST /api/transcripts/jobs/[id]/cancel — user-requested force stop for a
// transcript still in flight. Mirrors the desk cancel contract.
//
// Unlike desk, transcripts have no long-running in-process runner to poll a
// cancel flag — the heavy work runs at the provider (ElevenLabs/Deepgram) and
// finalizes through the client-driven /poll endpoint. So cancel is finalized
// DIRECTLY here: flip status → 'cancelled' (terminal) and set cancel_requested
// so a late /poll completion is skipped (poll guards its terminal write with
// .neq('status','cancelled')). The provider job can't be hard-killed server
// side — its result is simply discarded. Idempotent.
//
// Refund mirrors desk: transcript credits are charged only on completion
// (poll/webhook/dispatch), so at cancel time there is usually nothing to
// refund — refundCredits is a no-op (not_found) in that case. We still call it
// so a mid-flight cancel that races a just-completed charge is reversed,
// keeping the refund rule identical to desk.
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
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  // RLS rejects non-members; the explicit org_id filter is a belt-and-braces
  // guard so a stray id from another org can't be cancelled.
  const { data: job, error: fetchErr } = await supabase
    .from('transcript_jobs')
    .select('id, status, org_id, user_id')
    .eq('id', id)
    .eq('org_id', org.org_id)
    .single();
  if (fetchErr || !job) {
    return NextResponse.json({ error: fetchErr?.message ?? 'not_found' }, { status: 404 });
  }
  if (['done', 'error', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ ok: true, already: true, status: job.status });
  }

  const admin = createAdminClient();
  const { error: updErr } = await admin
    .from('transcript_jobs')
    .update({ status: 'cancelled', cancel_requested: true, error_message: 'cancelled_by_user' })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Best-effort refund — no-op when nothing was charged yet (charge happens on
  // completion). Same rule as desk: cancelled runs are refunded.
  await refundCredits(org.org_id, job.user_id, 'transcripts', id).catch(() => {});

  return NextResponse.json({ ok: true });
}
