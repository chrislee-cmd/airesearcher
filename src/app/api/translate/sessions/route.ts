// AI 동시통역 — create a realtime translate session.
//
// On a single request we:
//   1. insert the translate_sessions row (org-scoped, host_user_id)
//   2. issue an OpenAI Realtime ephemeral client_secret (~60s)
//   3. issue a LiveKit host token (publish + subscribe) for the room
//
// The client uses (2) to WebRTC-connect to OpenAI and (3) to publish the
// original + translated tracks into the LiveKit room that viewers will
// later subscribe to.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { buildHostToken, livekitUrl } from '@/lib/livekit-tokens';
import { issueRealtimeSession, realtimeModel } from '@/lib/openai-realtime';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.object({
  source_lang: z.string().min(2).max(8).default('ko'),
  target_lang: z.string().min(2).max(8).default('en'),
  record_enabled: z.boolean().default(true),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { source_lang, target_lang, record_enabled } = parsed.data;

  // 1) insert session row
  const insert = await supabase
    .from('translate_sessions')
    .insert({
      org_id: org.org_id,
      host_user_id: user.id,
      source_lang,
      target_lang,
      record_enabled,
      status: 'idle',
    })
    .select('id, source_lang, target_lang, status, record_enabled')
    .single();
  if (insert.error || !insert.data) {
    return NextResponse.json(
      { error: insert.error?.message ?? 'create_failed' },
      { status: 500 },
    );
  }
  const session = insert.data;
  const roomName = `translate:${session.id}`;

  // Persist the canonical room name so the viewer RPC can return it
  // without recomputing.
  await supabase
    .from('translate_sessions')
    .update({ livekit_room: roomName })
    .eq('id', session.id);

  // 2) OpenAI Realtime ephemeral
  let openaiSession;
  try {
    openaiSession = await issueRealtimeSession({
      sourceLang: source_lang,
      targetLang: target_lang,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'openai_failed' },
      { status: 502 },
    );
  }

  // 3) LiveKit host token
  let livekitToken: string;
  let livekitWsUrl: string;
  try {
    livekitToken = await buildHostToken({
      roomName,
      identity: user.id,
    });
    livekitWsUrl = livekitUrl();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'livekit_failed' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    session: { ...session, livekit_room: roomName },
    openai: {
      model: realtimeModel(),
      client_secret: openaiSession.client_secret,
    },
    livekit: {
      url: livekitWsUrl,
      token: livekitToken,
      room: roomName,
    },
  });
}
