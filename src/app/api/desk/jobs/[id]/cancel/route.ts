import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// POST /api/desk/jobs/[id]/cancel — flip the cancel_requested flag so the
// background runner exits at its next checkpoint. Idempotent.
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
    .select('id, status')
    .eq('id', id)
    .eq('org_id', org.org_id)
    .single();
  if (fetchErr || !job) {
    return NextResponse.json({ error: fetchErr?.message ?? 'not_found' }, { status: 404 });
  }
  if (['done', 'error', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ ok: true, already: true, status: job.status });
  }

  const { error: updErr } = await supabase
    .from('desk_jobs')
    .update({ cancel_requested: true })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
