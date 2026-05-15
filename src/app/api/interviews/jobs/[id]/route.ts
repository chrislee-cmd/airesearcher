import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Used to backfill consolidated insights after the vertical-synthesis pass
// completes. The initial POST /api/interviews/jobs is fired the moment the
// raw matrix lands, but consolidated insights arrive a few seconds later;
// this PATCH lets the client attach them to the same row so the workspace
// content endpoint can regenerate the markdown digest server-side.

const Body = z.object({
  consolidated: z.unknown(),
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

  const { error } = await supabase
    .from('interview_jobs')
    .update({ consolidated: parsed.data.consolidated })
    .eq('org_id', org.org_id)
    .eq('id', id);

  if (error) {
    console.error('[interviews/jobs/:id] patch error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
