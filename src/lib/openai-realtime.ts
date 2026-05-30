// OpenAI Realtime ephemeral session issuer.
//
// We use the conversational `gpt-realtime` model with a terse
// interpreter system prompt rather than the dedicated
// `gpt-realtime-translate` model. The translation-only model has no
// voice control and emits a coarser source-language transcript, both
// of which made the captions feel scrappy.
//
// Crucially, turn detection is `semantic_vad` with `eagerness=high`,
// NOT `server_vad`. server_vad waits for a silence gap before the
// model commits a turn, which produces a "wait for the speaker to
// pause, then translate" cadence — that's consecutive interpretation,
// not simultaneous, and the product cannot ship that way. semantic_vad
// at high eagerness chunks audio the moment the model has enough
// meaning to commit a phrase, with `interrupt_response=true` so new
// input can re-steer an in-flight response. Same conversational event
// shape as server_vad, so input/output captions still flow cleanly via
// the standard conversation.item.input_audio_transcription.* and
// response.text.* events.
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
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'high',
            create_response: true,
            interrupt_response: true,
          },
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
