import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getTopline } from '@/lib/interview-v2/topline';

// POST /api/interviews/v2/topline/cancel { project_id } — user force-stop for a
// topline still generating.
//
// Durable consistency (this spec's core risk): topline generation is a durable
// map-reduce job with three re-kick paths — POST /resume, GET on-read
// self-heal (#1014), and the resume-sweep cron (#1016). All three gate on
// status='generating', so flipping the row to 'cancelled' here makes it
// invisible to every re-kick path — it is never revived. The only remaining
// race is the *currently in-flight* hop's terminal write; runTopline's
// done/error/blocks writes are guarded with .eq('status','generating') so they
// no-op once cancelled. A map hop in progress simply detects the non-generating
// status on its next read and aborts (runTopline early-returns).
//
// No refund: topline generation charges no credits (cost is controlled by
// caching — POST route comment "신규 과금 없음"). There is nothing to reverse,
// so unlike desk/transcripts this endpoint does not call refundCredits.
//
// The cancel write is guarded with .eq('status','generating') so it is a no-op
// on a row that already reached a terminal state (done/error) — idempotent.
export const maxDuration = 30;

const Body = z.object({
  project_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { project_id } = parsed.data;

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const existing = await getTopline(admin, project_id);
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (existing.status !== 'generating') {
    // Already terminal (done/error/cancelled) or never started — nothing to do.
    return NextResponse.json({ ok: true, already: true, status: existing.status });
  }

  const { error: updErr } = await admin
    .from('interview_toplines')
    .update({ status: 'cancelled', error_message: 'cancelled_by_user' })
    .eq('id', existing.id)
    // Only cancel a row that's still generating — no-op if it just finished.
    .eq('status', 'generating');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'cancelled' });
}
