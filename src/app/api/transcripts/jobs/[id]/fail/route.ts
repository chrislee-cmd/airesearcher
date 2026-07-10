import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Mark a row-first transcript job as failed. Called by the client when the
// upload (or upload→handoff) fails for a row it pre-created with
// status='uploading'. The row is preserved and flipped to 'error' + message so
// it stays visible in the list (retry / delete) instead of silently vanishing.
//
// Scope is deliberately narrow: it only ever writes status='error'. Ownership
// is enforced by RLS (tj_update_owner_or_admin). Terminal 'done' rows are left
// untouched so a late upload-abort can't clobber a completed transcript.

const Body = z.object({
  message: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  const message = parsed.success ? parsed.data.message : undefined;

  const { error } = await supabase
    .from('transcript_jobs')
    .update({ status: 'error', error_message: message ?? 'upload_failed' })
    .eq('id', id)
    .neq('status', 'done');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
