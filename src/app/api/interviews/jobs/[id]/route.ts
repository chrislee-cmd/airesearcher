import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Used to backfill consolidated insights after the vertical-synthesis pass
// completes. The initial POST /api/interviews/jobs is fired the moment the
// raw matrix lands, but consolidated insights arrive a few seconds later;
// this PATCH lets the client attach them to the same row so the workspace
// content endpoint can regenerate the markdown digest server-side.
//
// Also carries the V2-upload observability skip-marker: when the client's
// batch pipeline fails BEFORE the index route ever runs (every file failed to
// convert, or every index chunk was 429'd/errored before the route's
// 'indexing' write), the job row would otherwise sit at index_status='pending'
// with no reason recorded — the silent residue this feature removes. The
// client PATCHes { index_status:'error', error_message } so DB/admin alone
// shows the failure and its cause. index_status is intentionally restricted to
// 'error' (the client never needs to set anything else here), and the write is
// guarded server-side to only fire while the row is still 'pending' so it can
// never overwrite a status the index route already owns (respect OBS-4 — no
// double-marking / race).

const Body = z.object({
  consolidated: z.unknown().optional(),
  index_status: z.literal('error').optional(),
  error_message: z.string().max(500).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ error: 'no_org' }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // Build the patch from only the fields actually supplied so a consolidated
  // backfill never clears the status marker and vice-versa.
  const update: Record<string, unknown> = {};
  if (parsed.data.consolidated !== undefined) {
    update.consolidated = parsed.data.consolidated;
  }
  if (parsed.data.index_status !== undefined) {
    update.index_status = parsed.data.index_status;
  }
  if (parsed.data.error_message !== undefined) {
    update.error_message = parsed.data.error_message;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  let query = supabase
    .from('interview_jobs')
    .update(update)
    .eq('org_id', org.org_id)
    .eq('id', id);
  // Observability skip-marker guard: only stamp 'error' while the row is still
  // 'pending'. If the index route already advanced the status (indexing / done
  // / error via OBS-4) this update matches 0 rows and is a no-op — the route
  // stays the source of truth.
  if (parsed.data.index_status === 'error') {
    query = query.eq('index_status', 'pending');
  }

  const { error } = await query;

  if (error) {
    console.error('[interviews/jobs/:id] patch error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
