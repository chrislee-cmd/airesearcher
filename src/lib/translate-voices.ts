// Voices supported by the OpenAI Realtime translation model.
//
// This list is read by both the server (Zod enum on the session-create
// route, OpenAI request body) and the client console UI. Lives in its
// own module so the browser bundle doesn't have to pull in
// `openai-realtime.ts`, which references `OPENAI_API_KEY`.
//
// Omitting `voice` from the request body falls back to OpenAI's default.
export const TRANSLATE_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

export type TranslateVoice = (typeof TRANSLATE_VOICES)[number];
