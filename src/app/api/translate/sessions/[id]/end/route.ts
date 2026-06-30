// AI 동시통역 — end an active session.
//
// Foundation PR: flips status to 'ended' and stamps ended_at. Credit
// settlement, LiveKit room close, and OpenAI session teardown land in PR #2.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // Wrap the whole handler: the host fires /end from a `pagehide`/stop
  // path where an unhandled throw (cookie/Supabase client init, network
  // blip) surfaced as an opaque 500 with no detail in the console. Catch
  // it, log it, and return the message so the failure is diagnosable.
  try {
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
    if (readErr) {
      console.error('[translate/end] session lookup failed', {
        session_id: id,
        error: readErr.message,
      });
      return NextResponse.json(
        { error: 'session_lookup_failed', detail: readErr.message },
        { status: 500 },
      );
    }
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
    if (error) {
      console.error('[translate/end] status update failed', {
        session_id: id,
        error: error.message,
      });
      return NextResponse.json(
        { error: 'end_update_failed', detail: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[translate/end] unhandled exception', {
      session_id: id,
      error: detail,
    });
    return NextResponse.json({ error: 'end_failed', detail }, { status: 500 });
  }
}
