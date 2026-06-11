// Gemini Live Translate ephemeral auth-token issuer.
//
// We use `gemini-3.5-live-translate-preview`, the dedicated translation
// model on Gemini Live API. Like OpenAI's `gpt-realtime-translate`, it
// streams continuous simultaneous interpretation (no turn boundary) —
// audio in, translated audio out, source + target transcript deltas.
// The model auto-detects the source language; only the target is
// configured at session create via `translationConfig.targetLanguageCode`.
//
// Server mints an ephemeral auth token (single-use; ~30 min lifetime,
// 1 min new-session window) so the browser can open the Bidi WebSocket
// directly against `generativelanguage.googleapis.com/v1alpha` without
// ever seeing GEMINI_API_KEY. The token's `liveConnectConstraints` lock
// the model + translation config server-side so the browser cannot
// reconfigure them.
//
// Reference: https://ai.google.dev/gemini-api/docs/live-api/live-translate

import { GoogleGenAI, Modality } from '@google/genai';

const DEFAULT_LIFETIME_MS = 30 * 60 * 1000; // 30 min — Gemini default
const DEFAULT_OPEN_WINDOW_MS = 60 * 1000;   // 60 sec to open the WS

export type GeminiLiveToken = {
  value: string;
  expires_at: number;
};

export type GeminiLiveSession = {
  client_secret: GeminiLiveToken;
  model: string;
};

export function liveTranslateModel(): string {
  return process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.5-live-translate-preview';
}

export async function issueLiveTranslateSession(opts: {
  // `sourceLang` is UI metadata only — Gemini auto-detects the input language.
  sourceLang: string;
  // BCP-47 code: "en", "ko", "ja", ...
  targetLang: string;
}): Promise<GeminiLiveSession> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('missing_gemini_key');

  const model = liveTranslateModel();
  const ai = new GoogleGenAI({ apiKey });
  const expireAt = new Date(Date.now() + DEFAULT_LIFETIME_MS);
  const newSessionExpireAt = new Date(Date.now() + DEFAULT_OPEN_WINDOW_MS);

  let token;
  try {
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireAt.toISOString(),
        newSessionExpireTime: newSessionExpireAt.toISOString(),
        httpOptions: { apiVersion: 'v1alpha' },
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: {
              targetLanguageCode: opts.targetLang,
              // Stay silent when the input is already in the target
              // language — for unidirectional interpretation we don't
              // want to parrot back source-side echo.
              echoTargetLanguage: false,
            },
            // We leave realtimeInputConfig at the default
            // (`START_OF_ACTIVITY_INTERRUPTS`). Gemini Live emits
            // refinement passes — when the model revises its earlier ASR
            // ("2回目" → "初めて"), the second pass arrives as a brand-new
            // model turn whose audio gets queued behind the first. Default
            // barge-in lets the new turn supersede the previous, so the
            // listener hears the revised translation instead of both.
          },
        },
      },
    });
  } catch (e) {
    throw new Error(
      `gemini_live_token_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const name = token.name;
  if (!name || typeof name !== 'string') {
    throw new Error('gemini_live_token_invalid_response');
  }
  return {
    model,
    client_secret: {
      value: name,
      expires_at: Math.floor(expireAt.getTime() / 1000),
    },
  };
}
