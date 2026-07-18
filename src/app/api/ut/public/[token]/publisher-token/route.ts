// POST /api/ut/public/[token]/publisher-token
//   → { livekit: { url, token, room } }
//
// Mints a LiveKit PUBLISH-only token for the anon participant so they can push
// their screen + mic tracks into the room (the researcher subscribes with a
// separate viewer token). This is also the "join" moment: we stamp
// participant_joined_at + walk status 'waiting' → 'live' so the researcher's
// monitor knows the participant is on. Mirrors the translate viewer-token route
// but publish-only instead of subscribe-only.
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { resolveUtToken } from '@/lib/ut/public';
import { buildPublisherToken, livekitUrl } from '@/lib/livekit-tokens';

export const runtime = 'nodejs';
export const maxDuration = 15;

function anonId(): string {
  return randomBytes(8).toString('hex');
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;

  // Once the researcher has ended the session (done/error), no new participant
  // stream is accepted.
  if (session.status === 'done' || session.status === 'error') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }

  const roomName = session.livekit_room || `ut:${session.id}`;

  let lkToken: string;
  let url: string;
  try {
    lkToken = await buildPublisherToken({
      roomName,
      identity: `participant-${anonId()}`,
    });
    url = livekitUrl();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'livekit_failed' },
      { status: 502 },
    );
  }

  // Stamp the join once — walk waiting → live but never regress a session that's
  // already uploading/transcribing/done. participant_joined_at records the first
  // join and is left intact on reconnect.
  if (session.status === 'waiting') {
    await admin
      .from('ut_sessions')
      .update({ status: 'live', participant_joined_at: new Date().toISOString() })
      .eq('id', session.id)
      .is('participant_joined_at', null);
  }

  return NextResponse.json({ livekit: { url, token: lkToken, room: roomName } });
}
