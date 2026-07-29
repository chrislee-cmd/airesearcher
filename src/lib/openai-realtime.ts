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
// Standard (non-translations) Realtime client_secrets endpoint. Unlike the
// translations family this one accepts a transcription-only session
// (`session.type='transcription'`) AND — crucially — an explicit
// `audio.input.transcription.language` source hint. That is the whole reason
// the source-caption lane is split off here (fix A): the translations endpoint
// rejects the language hint with a 400, so a ko session gets no Korean prior
// and drifts into Japanese-kana / English hallucinations. A dedicated
// transcription session pins the source language and recognises it directly.
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
  return env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-translate';
}

// Model for the split-off SOURCE transcription lane (fix A). Migrated (581) to
// the realtime-native `gpt-live-transcribe` (env-switchable). The new family
// takes a `languages` ARRAY + `keywords`/`prompt`; the legacy gpt-4o[-mini]-
// transcribe family takes the singular `language` and rejects those — the
// caller branches on usesLiveTranscribeConfig() so the env rollback switch keeps
// working with either family. The source language hint below still blocks the
// #556 kana fallback either way.
export function sourceTranscriptionModel(): string {
  return env.OPENAI_TRANSLATE_SOURCE_MODEL ?? 'gpt-live-transcribe';
}

// gpt-live-transcribe / gpt-transcribe accept a `languages` ARRAY + `keywords` +
// `prompt`; the legacy gpt-4o-transcribe / gpt-4o-mini-transcribe family takes
// the singular `language` and rejects the new fields. Branch on the model name
// so the env rollback switch (spec constraint 1) stays valid for both families.
// The '4o' families are the only legacy transcribe models, so a plain prefix
// check cleanly separates them from the new gpt-(live-)transcribe names.
export function usesLiveTranscribeConfig(model: string): boolean {
  return (
    model.startsWith('gpt-live-transcribe') || model.startsWith('gpt-transcribe')
  );
}

// keywords must each be a single line free of `<`, `>`, CR and LF (OpenAI
// constraint). Sanitize + dedupe + cap (defensive — glossary is already
// bounded, but UT/other callers may not be).
export function sanitizeKeywords(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const term of raw) {
    if (typeof term !== 'string') continue;
    const clean = term.replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 100) break;
  }
  return out;
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
        // Audio output is automatic on `gpt-realtime-translate` and uses
        // dynamic voice adaptation (translated speech follows the source
        // speaker's tone) — there is NO output voice selector. Passing
        // `output.voice` is rejected with a 400 `unknown_parameter`, which
        // fails session creation outright. `language` is the only field
        // this endpoint accepts here. The "발화 0" symptom is therefore a
        // client-side playback issue (autoplay / track attach), not a
        // session-config one — tracked in pr-translate-tts-playback-hardening.
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

// Issue an ephemeral client_secret for the SOURCE transcription lane (fix A).
//
// This is a SEPARATE session from the translation session above. The
// translation session (`gpt-realtime-translate`, translations endpoint) still
// produces the translated text + translated audio; this transcription session
// produces the SOURCE captions with the source language pinned, so a Korean
// interview is recognised as Korean instead of drifting to Japanese kana.
//
// The client feeds the SAME captured audio track into both sessions' peer
// connections and displays this lane's transcript as the source caption. On
// failure the client transparently falls back to the translation session's
// `session.input_transcript.delta` (old behaviour), so a source-lane outage is
// a graceful downgrade, never a caption blackout.
//
// `session.type='transcription'` + `audio.input.transcription.language` mirror
// the probing transcription session (src/app/api/probing/sessions/route.ts) —
// the reference implementation for realtime STT sessions in this repo. Unlike
// the translations endpoint, this one accepts the language hint.
export async function issueSourceTranscriptionSession(opts: {
  // Session source language (UI value like "ko" / "ko-KR"). Normalised to a
  // bare ISO-639-1 code for the API. When it doesn't resolve to a 2-letter
  // code the hint is omitted and the model autodetects (never hard-coded ko).
  sourceLang: string;
  // Domain glossary (translate_sessions.glossary) — injected as live `keywords`
  // on the new gpt-live-transcribe family so specialist terms transcribe
  // correctly in the source caption itself, not just in the postprocess pass.
  // Ignored on the legacy family (which rejects `keywords`).
  keywords?: readonly string[];
}): Promise<OpenAIRealtimeSession> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('missing_openai_key');

  const model = sourceTranscriptionModel();
  const lang = iso639(opts.sourceLang);
  const newFamily = usesLiveTranscribeConfig(model);
  const keywords = opts.keywords ? sanitizeKeywords(opts.keywords) : [];
  // Pin the source language when known (2-letter ISO). This is the parameter the
  // translations endpoint rejects — the crux of fix A. The new family takes a
  // `languages` ARRAY; the legacy family takes the singular `language`.
  const langField =
    lang.length === 2
      ? newFamily
        ? { languages: [lang] }
        : { language: lang }
      : {};
  const body = {
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model,
            ...langField,
            // Live glossary injection — new family only (legacy rejects it).
            ...(newFamily && keywords.length ? { keywords } : {}),
          },
          // server_vad so the session emits `*.completed` per utterance
          // boundary (mirrors the probing route). silence_duration matches the
          // client-side tab silence pulse window.
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
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
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `openai_transcription_session_failed: ${res.status} ${detail.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    client_secret?: { value?: string; expires_at?: number } | string;
    value?: string;
    expires_at?: number;
  };
  // OpenAI returns the secret in two observed shapes (object or bare string) —
  // absorb both, same as the probing route.
  const cs = json.client_secret;
  const value = typeof cs === 'string' ? cs : cs?.value ?? json.value;
  const expires_at =
    typeof cs === 'object' && cs ? cs.expires_at : json.expires_at;
  if (!value || typeof value !== 'string') {
    throw new Error('openai_transcription_session_invalid_response');
  }
  return {
    model,
    client_secret: {
      value,
      expires_at: expires_at ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS,
    },
  };
}
