// AI 동시통역 — hourly cron that retires expired sessions.
//
// Translate sessions hold a `expires_at` (default 4h ahead) and a
// `share_token`. When the window closes we:
//   - flip status to 'ended'
//   - null out share_token so any cached viewer URL stops working
//   - stamp ended_at so the host's history shows when the session
//     actually closed
//
// We also pick up stragglers where the host never explicitly stopped:
// a session that's been "live" for more than 6h without an end_at gets
// the same treatment so LiveKit rooms don't linger.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // local dev / no secret set
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const liveStaleCutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

  // 1) Sessions past their expires_at.
  const expired = await admin
    .from('translate_sessions')
    .update({
      status: 'ended',
      share_token: null,
      ended_at: nowIso,
    })
    .lt('expires_at', nowIso)
    .in('status', ['idle', 'live'])
    .select('id');
  if (expired.error) {
    return NextResponse.json({ error: expired.error.message }, { status: 500 });
  }

  // 2) Long-running 'live' sessions with no expires_at (host left tab
  //    open and walked away). Treat 6h as a hard ceiling.
  const liveTimedOut = await admin
    .from('translate_sessions')
    .update({
      status: 'ended',
      share_token: null,
      ended_at: nowIso,
    })
    .lt('started_at', liveStaleCutoff)
    .eq('status', 'live')
    .is('expires_at', null)
    .select('id');
  if (liveTimedOut.error) {
    return NextResponse.json({ error: liveTimedOut.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired: expired.data?.length ?? 0,
    live_timed_out: liveTimedOut.data?.length ?? 0,
  });
}
