// POST /api/ut/sessions/[id]/viewer-token → { livekit: { url, token, room } }
//
// Mints a LiveKit SUBSCRIBE-only token for the RESEARCHER (session owner or a
// super-admin) so they can join the room and watch the participant's live
// screen + mic — without ever publishing. This is the mirror of the anon
// publisher-token: participant = publish-only, researcher = subscribe-only, a
// clean permission split enforced at the SFU. Owner/super-admin gate via
// loadUtSession (the researcher IS an authenticated user, unlike the
// participant). Remote sessions only.
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { loadUtSession } from '@/lib/ut/auth';
import { buildViewerToken, livekitUrl } from '@/lib/livekit-tokens';

export const runtime = 'nodejs';
export const maxDuration = 15;

function anonId(): string {
  return randomBytes(8).toString('hex');
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { session, user } = gate;

  if (session.mode !== 'remote') {
    return NextResponse.json({ error: 'not_remote' }, { status: 400 });
  }
  const roomName = session.livekit_room || `ut:${session.id}`;

  let lkToken: string;
  let url: string;
  try {
    lkToken = await buildViewerToken({
      roomName,
      // Distinct identity so multiple researcher tabs don't collide in the room.
      identity: `researcher-${user.id.slice(0, 8)}-${anonId()}`,
    });
    url = livekitUrl();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'livekit_failed' },
      { status: 502 },
    );
  }

  return NextResponse.json({ livekit: { url, token: lkToken, room: roomName } });
}
