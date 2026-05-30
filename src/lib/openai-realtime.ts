// OpenAI Realtime ephemeral session issuer.
//
// We use the conversational `gpt-realtime` model with a terse
// interpreter system prompt rather than the dedicated
// `gpt-realtime-translate` model. The translation-only model has no
// voice control and emits a coarser source-language transcript, both
// of which made the captions feel scrappy. The conversational model
// driven by server VAD gives clean, item-bucketed transcript events on
// both sides and lets the host pick the TTS voice.
//
// The API hands the browser an ephemeral client_secret (default 600s)
// which it uses as a Bearer token when POSTing its WebRTC SDP offer to
// /v1/realtime/calls. Model + session config are bound to the token
// server-side.

import { buildTranslateInstructions } from './translate-instructions';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_TTL_SECONDS = 600;

export type OpenAIRealtimeClientSecret = {
  value: string;
  expires_at: number;
};

export type OpenAIRealtimeSession = {
  client_secret: OpenAIRealtimeClientSecret;
  model: string;
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

  const model = realtimeModel();
  const body = {
    expires_after: { anchor: 'created_at', seconds: DEFAULT_TTL_SECONDS },
    session: {
      type: 'realtime',
      model,
      instructions: buildTranslateInstructions(opts.sourceLang, opts.targetLang),
      output_modalities: ['audio'],
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'server_vad' },
        },
        output: { voice: opts.voice ?? 'verse' },
      },
    },
  };

  const res = await fetch(CLIENT_SECRETS_URL, {
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

  const json = (await res.json()) as {
    value?: string;
    client_secret?: string;
    expires_at?: number;
  };
  const value = json.value ?? json.client_secret;
  if (!value || typeof value !== 'string') {
    throw new Error('openai_realtime_session_invalid_response');
  }
  return {
    model,
    client_secret: {
      value,
      expires_at: json.expires_at ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS,
    },
  };
}
