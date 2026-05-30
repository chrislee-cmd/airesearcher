// OpenAI Realtime ephemeral session issuer.
//
// We hold the API key on the server and hand the browser a short-lived
// client_secret (~60s). The browser uses it to set up a WebRTC peer
// connection directly with OpenAI — audio in, audio + text out.

import { buildTranslateInstructions } from './translate-instructions';

const REALTIME_SESSIONS_URL = 'https://api.openai.com/v1/realtime/sessions';

export type OpenAIRealtimeClientSecret = {
  value: string;
  expires_at: number;
};

export type OpenAIRealtimeSession = {
  id: string;
  model: string;
  client_secret: OpenAIRealtimeClientSecret;
};

export function realtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime';
}

export async function issueRealtimeSession(opts: {
  sourceLang: string;
  targetLang: string;
  voice?: string;
}): Promise<OpenAIRealtimeSession> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('missing_openai_key');

  const body = {
    model: realtimeModel(),
    voice: opts.voice ?? 'verse',
    modalities: ['audio', 'text'],
    input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
    turn_detection: { type: 'server_vad' },
    instructions: buildTranslateInstructions(opts.sourceLang, opts.targetLang),
  };

  const res = await fetch(REALTIME_SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`openai_realtime_session_failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as OpenAIRealtimeSession;
  if (!json?.client_secret?.value) {
    throw new Error('openai_realtime_session_invalid_response');
  }
  return json;
}
