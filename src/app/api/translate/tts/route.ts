// AI 동시통역 — custom TTS synthesis (single fixed voice).
//
// The host console diverts the realtime model's dynamic-voice audio and
// re-synthesizes the translated TEXT through this route so the whole
// session speaks in ONE fixed voice (see src/lib/translate-tts.ts and
// openai-realtime.ts for why the model-side voice can't be pinned).
//
// Server-side so the OpenAI key never reaches the browser. Voice + model
// are server constants (env-overridable) — the client never chooses the
// voice, which is the entire point (consistency). Auth mirrors the other
// translate session routes: the caller must be the session host.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/env';

export const runtime = 'nodejs';
export const maxDuration = 30;

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
// Cap per-request input so a runaway commit can't spool a giant synthesis.
// A single translated sentence is well under this; the client already
// splits on sentence boundaries.
const MAX_INPUT_CHARS = 800;

export async function POST(req: Request) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
  }

  let body: {
    session_id?: string;
    text?: string;
    lang?: string;
    slot?: 'mic' | 'tab';
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const sessionId = body.session_id;
  const text = (body.text ?? '').trim();
  if (!sessionId || !text) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: 'text_too_long' }, { status: 413 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: row, error } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'ended') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }

  // 2-voice slot mapping: mic (host) and tab (guest) get distinct voices so
  // listeners hear who is speaking. Each per-slot override falls back to the
  // base fixed voice when unset, and an absent/unknown slot (single-source
  // sessions send none) always uses the base voice — so the single-voice
  // behavior is preserved unless an operator opts in via the env overrides.
  const voice =
    body.slot === 'mic'
      ? env.TRANSLATE_TTS_VOICE_MIC ?? env.TRANSLATE_TTS_VOICE
      : body.slot === 'tab'
        ? env.TRANSLATE_TTS_VOICE_TAB ?? env.TRANSLATE_TTS_VOICE
        : env.TRANSLATE_TTS_VOICE;

  // WAV so the browser can `decodeAudioData` it with zero codec ambiguity
  // and no MP3-decode latency — the payload is host↔server only (LiveKit
  // publishes the decoded PCM, not this response).
  let res: Response;
  try {
    res = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.TRANSLATE_TTS_MODEL,
        voice,
        input: text,
        response_format: 'wav',
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'openai_failed' },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `openai_tts_failed`, detail: detail.slice(0, 200) },
      { status: 502 },
    );
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
    },
  });
}
