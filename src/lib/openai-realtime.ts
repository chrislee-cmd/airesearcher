// OpenAI Realtime ephemeral session issuer.
//
// We use the **dedicated translation model** `gpt-realtime-translate`
// at the `/v1/realtime/translations/*` endpoint family. This model has
// no conversation lifecycle and no turn detection — it streams source
// transcription, translated transcription, and translated audio
// continuously as input audio arrives. That's the actual simultaneous
// interpretation behaviour a UN-style interpreter has.
//
// The conversational `gpt-realtime` model — with any VAD setting,
// server or semantic — always pauses on a turn boundary before
// emitting. That cadence cannot ship as live interpretation, so it is
// not an option here.
//
// Source-language transcript: the WebRTC variant of the translations
// API does not auto-emit `session.input_transcript.delta` events.
// They only appear when input transcription is explicitly enabled via
// `audio.input.transcription`, with `gpt-4o-mini-transcribe` as the
// model (chosen over `gpt-4o-transcribe` because it produced cleaner
// captions in side-by-side testing).
//
// Reference: https://developers.openai.com/api/docs/guides/realtime-translation

import { env } from '@/env';

const TRANSLATIONS_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/translations/client_secrets';
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
  return env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-translate';
}

export async function issueRealtimeSession(opts: {
  // `sourceLang` is purely UI metadata — the translation model autodetects
  // the input language and does not accept a source-language hint.
  sourceLang: string;
  // `targetLang` is required: BCP-47 code like "en", "ko", "ja".
  targetLang: string;
}): Promise<OpenAIRealtimeSession> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('missing_openai_key');

  const model = realtimeModel();
  const body = {
    expires_after: { anchor: 'created_at', seconds: DEFAULT_TTL_SECONDS },
    session: {
      model,
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
        },
        output: { language: opts.targetLang },
      },
    },
  };

  const res = await fetch(TRANSLATIONS_CLIENT_SECRETS_URL, {
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
