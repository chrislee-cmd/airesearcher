// AI 동시통역 — mark a session live and stamp its start time.
//
// The host console calls this the moment at least one realtime slot
// connects (go-live). Historically the console flipped the row itself
// with a fire-and-forget `supabase.from().update()`, but that builder
// was never awaited — supabase-js only sends the PATCH when the thenable
// is awaited/`.then()`d, so the request never left the browser. Result:
// `status` stayed 'idle' and `started_at` stayed NULL for every session,
// which (a) broke export/viewer start-time, and (b) neutered the
// cleanup cron's straggler clause (it filters `.eq('status','live')`).
//
// Routing go-live through the server makes the write reliable and
// mirrors the existing `/end` route. `started_at` is stamped only when
// still NULL so a reconnect/re-entry never overwrites the true first
// go-live time.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data: row, error: readErr } = await supabase
      .from('translate_sessions')
      .select('id, host_user_id, status, started_at')
      .eq('id', id)
      .maybeSingle();
    if (readErr) {
      console.error('[translate/start] session lookup failed', {
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
    // An already-ended session must not be resurrected to 'live'.
    if (row.status === 'ended') {
      return NextResponse.json({ error: 'session_ended' }, { status: 410 });
    }

    // Preserve the first go-live time — only stamp when still NULL.
    const patch: { status: 'live'; started_at?: string } = { status: 'live' };
    if (!row.started_at) patch.started_at = new Date().toISOString();

    const { error } = await supabase
      .from('translate_sessions')
      .update(patch)
      .eq('id', id);
    if (error) {
      console.error('[translate/start] go-live update failed', {
        session_id: id,
        error: error.message,
      });
      return NextResponse.json(
        { error: 'start_update_failed', detail: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, started_at: patch.started_at ?? row.started_at });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[translate/start] unhandled exception', {
      session_id: id,
      error: detail,
    });
    return NextResponse.json({ error: 'start_failed', detail }, { status: 500 });
  }
}
