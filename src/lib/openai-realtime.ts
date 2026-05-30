// OpenAI Realtime ephemeral session issuer.
//
// We now use the **dedicated translation model** `gpt-realtime-translate`
// at the `/v1/realtime/translations/*` endpoint family. This model has
// no conversation lifecycle and no turn detection — it streams source
// transcription, translated transcription, and translated audio
// continuously as input audio arrives. That's the actual simultaneous
// interpretation behaviour a UN-style interpreter has, instead of the
// conversational `gpt-realtime` model which always waits for a turn
// boundary before responding.
//
// Reference: https://developers.openai.com/api/docs/guides/realtime-translation

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
  return process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-translate';
}

export async function issueRealtimeSession(opts: {
  // `sourceLang` is purely UI metadata — the translation model autodetects
  // the input language and does not accept a source-language hint.
  sourceLang: string;
  // `targetLang` is required: BCP-47 code like "en", "ko", "ja".
  targetLang: string;
}): Promise<OpenAIRealtimeSession> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('missing_openai_key');

  const model = realtimeModel();
  const body = {
    expires_after: { anchor: 'created_at', seconds: DEFAULT_TTL_SECONDS },
    session: {
      model,
      audio: {
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
