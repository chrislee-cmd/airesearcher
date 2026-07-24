// AI UT stale-'live' sweep cron — server-side self-heal (card #554).
//
// Root cause this backstops: a remote AI-UT session's "ended" signal used to
// depend ENTIRELY on the participant's finalize call. If the participant left
// abnormally (tab close / refresh / network drop / crash) the row stayed 'live'
// forever — the researcher's monitor froze on "🔴 관전 중". Three complementary
// fixes land together:
//   1. researcher client presence (ParticipantDisconnected) — moderated live UX,
//   2. participant pagehide beacon (/leave) — immediate DB cleanup when it fires,
//   3. THIS sweep — the robust DB-truth backstop for BOTH kinds, and the ONLY
//      cleanup for unmoderated (no researcher watching) or a hard crash where
//      the beacon never fires.
//
// Signal = LiveKit room occupancy, NOT a time-only cutoff. There is no heartbeat
// column on ut_sessions, and a naive "live longer than N minutes → kill" would
// wrongly reap legitimately-long moderated sessions. Instead we ask LiveKit
// whether the PARTICIPANT (publish identity `participant-*`; the researcher joins
// as `researcher-*` and must be ignored) is still in the room. A session is swept
// ONLY when LiveKit definitively reports the participant gone — so a still-
// connected participant is never killed regardless of session length.
//
// participant_joined_at is used purely as a settle grace (STALE_LIVE_MS): we
// don't even look at rooms younger than the grace, which avoids racing a just-
// joining participant or a brief LiveKit reconnect. Cleanup latency for a crash
// (beacon missed) is therefore ≈ grace; the timely paths (1)/(2) cover the rest.
//
// Fail-safe: a transient LiveKit error (network, 5xx) leaves the row for the next
// sweep rather than guessing. Only a definitive "room not found / no participant"
// triggers the error stamp. The update is guarded on status='live' for idempotency.
//
// Auth: standard Vercel cron pattern — Authorization: Bearer <CRON_SECRET>,
// fail-closed (mirrors topline-resume-sweep / gate/sweep). service_role client
// bypasses RLS.
import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Settle grace since the participant joined before a 'live' row is even a
// candidate — long enough that a genuine join has completed and a brief network
// reconnect has resolved (LiveKit's own reconnect window is far shorter). Within
// the spec's 10–15 min band, chosen at the conservative (false-positive-avoiding)
// end since LiveKit room-emptiness is the authoritative gate on top of it.
const STALE_LIVE_MS = 10 * 60 * 1000;

// Per-sweep cap so a mass of concurrently-stale sessions can't fan out into an
// unbounded number of LiveKit calls in one invocation; the remainder is drained
// by the next sweep (their participant_joined_at stays past the cutoff).
const QUERY_LIMIT = 50;

function authorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${env.CRON_SECRET}`;
}

function roomServiceClient(): RoomServiceClient | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  // RoomServiceClient wants the HTTP(S) API host; LIVEKIT_URL is the wss/ws URL.
  const host = LIVEKIT_URL.replace(/^ws/, 'http');
  return new RoomServiceClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// true  = the UT participant (a publish-identity `participant-*`) is still present
// false = definitively gone (room closed / no participant identity in the room)
// null  = couldn't determine (transient error) → caller leaves the row for later
async function participantPresent(
  svc: RoomServiceClient,
  roomName: string,
): Promise<boolean | null> {
  try {
    const participants = await svc.listParticipants(roomName);
    return participants.some((p) => p.identity.startsWith('participant-'));
  } catch (e) {
    // LiveKit auto-closes an empty room; listParticipants then throws a
    // not-found. Treat a not-found as definitively gone; any other error is
    // transient → return null so we don't reap on a network blip.
    const msg = e instanceof Error ? e.message.toLowerCase() : '';
    if (
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('notfound')
    ) {
      return false;
    }
    return null;
  }
}

type StaleRow = {
  id: string;
  livekit_room: string | null;
  meta: Record<string, unknown> | null;
};

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const svc = roomServiceClient();
  if (!svc) {
    // LiveKit unconfigured (e.g. preview without env) — nothing to verify, skip
    // cleanly rather than error. Remote UT is itself gated on LiveKit config.
    return NextResponse.json({ ok: true, skipped: 'livekit_unconfigured' });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_LIVE_MS).toISOString();

  const { data, error } = await admin
    .from('ut_sessions')
    .select('id, livekit_room, meta')
    .eq('mode', 'remote')
    .eq('status', 'live')
    .lt('participant_joined_at', cutoff)
    .order('participant_joined_at', { ascending: true })
    .limit(QUERY_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as StaleRow[];
  let swept = 0;
  let present = 0;
  let indeterminate = 0;

  for (const row of rows) {
    const roomName = row.livekit_room || `ut:${row.id}`;
    const alive = await participantPresent(svc, roomName);
    if (alive === true) {
      present += 1;
      continue;
    }
    if (alive === null) {
      indeterminate += 1;
      continue;
    }
    // Definitively gone — release the frozen 'live'. meta merged so existing
    // fields survive; guarded on status='live' so a concurrent finalize wins.
    const meta = { ...(row.meta ?? {}), error_reason: 'participant_lost' };
    const { error: updErr } = await admin
      .from('ut_sessions')
      .update({ status: 'error', ended_at: new Date().toISOString(), meta })
      .eq('id', row.id)
      .eq('status', 'live');
    if (!updErr) swept += 1;
  }

  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    swept,
    present,
    indeterminate,
  });
}
