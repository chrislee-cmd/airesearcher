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

// Normalize a UI language value ("ko", "en", "ko-KR") to the ISO-639-1
// base code the transcription model expects. The picker only ever emits
// bare 2-letter codes today, but a region subtag ("ko-KR") would make
// `gpt-4o-mini-transcribe` reject the hint and silently fall back to
// autodetect — defeating the whole point of pinning the language. Strip
// any subtag and lowercase so the hint is always valid.
function iso639(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

export async function issueRealtimeSession(opts: {
  // `sourceLang` pins the INPUT transcription language. The translation
  // model autodetects on its own, but `gpt-4o-mini-transcribe` (the
  // separate input-transcription model) accepts a `language` hint — and
  // without it, low-confidence Korean audio (filler words "어"/"음",
  // short utterances) gets decoded as Japanese phonetics, which is the
  // root cause of the "한국어 인터뷰인데 일본어 transcribe" audit finding.
  // Pinning the source language forces Korean decoding for a ko→en
  // session.
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
          transcription: {
            model: 'gpt-4o-mini-transcribe',
            // ★ Strict source-language transcription — blocks the
            // Japanese-fallback mojibake the audit flagged.
            language: iso639(opts.sourceLang),
          },
        },
        output: { language: iso639(opts.targetLang) },
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
