// Transcription provider/model registry.
//
// Each entry is an option the user can pick in the model selector. The server
// reads `provider` to dispatch and `apiModel` as the value sent to the API.

export type TranscriptProvider = 'deepgram' | 'elevenlabs';

export type TranscriptModelEntry = {
  key: string;            // internal id, sent from client
  label: string;          // Korean display label
  provider: TranscriptProvider;
  apiModel: string;       // value passed to provider API (Deepgram model name handled per-language)
  description?: string;
};

export const TRANSCRIPT_MODELS: TranscriptModelEntry[] = [
  {
    key: 'deepgram-nova',
    label: 'Deepgram Nova',
    provider: 'deepgram',
    apiModel: 'nova', // Deepgram model is resolved per-language in languages.ts
    description: '한국어/영어 등 주요 언어에 강함. 기본값.',
  },
  {
    key: 'elevenlabs-scribe-v2',
    label: 'ElevenLabs Scribe v2',
    provider: 'elevenlabs',
    apiModel: 'scribe_v2',
    description: '99개 언어 자동 감지. 다국어/잡음 환경에 강함.',
  },
];

export const DEFAULT_MODEL_KEY = 'deepgram-nova';

const BY_KEY: Record<string, TranscriptModelEntry> = Object.fromEntries(
  TRANSCRIPT_MODELS.map((m) => [m.key, m]),
);

export function getModel(key: string | null | undefined): TranscriptModelEntry {
  if (!key) return BY_KEY[DEFAULT_MODEL_KEY];
  return BY_KEY[key] ?? BY_KEY[DEFAULT_MODEL_KEY];
}
