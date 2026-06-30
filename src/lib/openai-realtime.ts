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
// `audio.input.transcription`.
//
// Input transcription model: `gpt-4o-transcribe` (the full model). An
// earlier side-by-side test preferred `gpt-4o-mini-transcribe` for
// slightly cleaner captions, but mini fell back to Japanese phonetics
// on low-confidence Korean audio — the audit's #1 finding: a Korean
// interview transcribed as Japanese kana (PR #556). The full model has
// stronger Korean acoustic modelling and falls into that failure mode
// far less often. The residual Japanese-only lines that still slip
// through are caught downstream by the script-guard in
// translate-console.tsx (`looksJapaneseFallback`), so the worst case is
// a marginally noisier caption — never a Japanese line in a ko session.
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
// base code the translations API expects for `output.language`. The
// picker only emits bare 2-letter codes today, but a region subtag
// ("ko-KR") would be rejected — strip any subtag and lowercase.
function iso639(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

export async function issueRealtimeSession(opts: {
  // `sourceLang` is purely UI metadata. We attempted to pin the input
  // transcription language to block the "한국어 인터뷰인데 일본어
  // transcribe" audit finding (low-confidence Korean → Japanese
  // phonetics), but the /realtime/translations endpoint rejects
  // `session.audio.input.transcription.language` with a 400
  // ("Unknown parameter") — the translations transcription config only
  // accepts `model`. The model autodetects the input language and there
  // is no supported source-language hint on this endpoint, so the
  // Japanese-fallback fix needs a different mechanism (see PR #556).
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
          transcription: { model: 'gpt-4o-transcribe' },
        },
        output: {
          language: iso639(opts.targetLang),
          // Without an explicit `voice`, the /realtime/translations
          // endpoint emits the text modality only — no TTS audio track is
          // published, so `pc.ontrack` never fires and the speaker stays
          // silent (P0: 통역 발화 0). `voice` switches on audio output.
          voice: 'alloy',
        },
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
