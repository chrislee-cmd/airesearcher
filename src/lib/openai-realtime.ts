// OpenAI Realtime ephemeral session issuer.
//
// We hold the API key on the server and hand the browser a short-lived
// client_secret (default 600s). The browser uses it as a Bearer token
// when posting its WebRTC SDP offer to /v1/realtime/calls — model and
// session config are already bound to the token server-side.
//
// API surface (verified 2026-05): the older `/v1/realtime/sessions`
// endpoint that returned `{ client_secret: { value, expires_at } }` is
// gone (404). The current shape is `/v1/realtime/client_secrets` with a
// nested `{ session: {...} }` body and a flat `client_secret` string
// (`ek_...`) in the response.

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
  return process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2';
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
          // server_vad with a very short silence_duration_ms (200ms vs
          // 500ms default) makes turn boundaries fire on every micro-pause
          // — both the input transcript and the model response stream in
          // small chunks instead of waiting for a full sentence. This
          // performs better than semantic_vad for Korean SOV, where the
          // semantic chunker tends to wait for subject+verb before
          // committing.
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 200,
            silence_duration_ms: 200,
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

  // New response shape: { value: "ek_...", expires_at: 1234567890, session: {...} }
  // The field name is `value` (not nested under `client_secret`) in the
  // current `/client_secrets` API.
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
