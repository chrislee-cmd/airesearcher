// AI 동시통역 — end an active session.
//
// Foundation PR: flips status to 'ended' and stamps ended_at. Credit
// settlement, LiveKit room close, and OpenAI session teardown land in PR #2.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

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

  const { data: row, error: readErr } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'ended') return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from('translate_sessions')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      share_token: null, // revoke viewer URL on end
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
