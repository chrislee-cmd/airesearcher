// AI 동시통역 — anon viewer LiveKit subscribe-only token.
//
// The viewer page fetches a JWT here so it can join the LiveKit room
// and subscribe to the input/output audio tracks (publish is denied
// at the SFU). We resolve the token → session via the public RPC so
// the token check is the same single source as `/api/translate/public`.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildViewerToken, livekitUrl } from '@/lib/livekit-tokens';

export const runtime = 'nodejs';
export const maxDuration = 15;

function anonId(): string {
  return randomBytes(8).toString('hex');
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 32) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_translate_session_by_token', {
    p_token: token,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.status === 'ended') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }
  const roomName: string = row.livekit_room || `translate:${row.id}`;

  let lkToken: string;
  let url: string;
  try {
    lkToken = await buildViewerToken({
      roomName,
      identity: `viewer-${anonId()}`,
    });
    url = livekitUrl();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'livekit_failed' },
      { status: 502 },
    );
  }
  return NextResponse.json({
    livekit: { url, token: lkToken, room: roomName },
  });
}
