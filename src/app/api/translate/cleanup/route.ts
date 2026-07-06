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
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

// PR-SEC21 — fail-closed. CRON_SECRET is required in env.ts; absent
// previously meant skipping auth entirely.
function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
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
  //    open and walked away). Treat 6h as a hard ceiling, measured from
  //    started_at (the go-live moment).
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

  // 3) created_at-based straggler safety net — independent of started_at.
  //    Clause (2) is blind whenever started_at is NULL (a regression of
  //    the go-live stamp, or a legacy zombie left 'idle' because the old
  //    client never persisted go-live). Reap any idle/live session with
  //    no expires_at that was created more than 6h ago. created_at is
  //    NOT NULL by schema, so this clause can never silently no-op the
  //    way the started_at filter did.
  const createdStaleCutoff = liveStaleCutoff; // same 6h ceiling
  const createdTimedOut = await admin
    .from('translate_sessions')
    .update({
      status: 'ended',
      share_token: null,
      ended_at: nowIso,
    })
    .lt('created_at', createdStaleCutoff)
    .in('status', ['idle', 'live'])
    .is('expires_at', null)
    .select('id');
  if (createdTimedOut.error) {
    return NextResponse.json({ error: createdTimedOut.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired: expired.data?.length ?? 0,
    live_timed_out: liveTimedOut.data?.length ?? 0,
    created_timed_out: createdTimedOut.data?.length ?? 0,
  });
}
