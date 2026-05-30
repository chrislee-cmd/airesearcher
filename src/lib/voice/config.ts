// Voice Concierge — centralized configuration constants.
//
// Single edit point for the persona name, voice, model, and credit policy.
// Both API routes (/api/voice/ephemeral) and the instructions builder
// (src/lib/voice/instructions.ts) import from here so changing the persona
// or voice ripples in one place.
//
// Decisions baked into PR2 (user-confirmed 2026-05-30, design §12.2 / §12.5):
//   - Persona name: "모치" (Mochi)
//   - Voice: 'verse' (warm, natural Korean per OpenAI 8-voice lineup)
//   - Model: gpt-realtime-2 (matches DEFAULT_OPENAI_REALTIME_MODEL in
//     @openai/agents-realtime — confirmed at PR2 install time)
//   - Credit policy: free + 10 minutes/org/day cumulative cap (design §8.1
//     option A). Quota check lives in /api/voice/ephemeral.

/** Persona display name. Surfaces in instructions ("당신은 모치예요"). */
export const VOICE_PERSONA_NAME = '모치';

/** OpenAI Realtime model id. */
export const VOICE_MODEL = 'gpt-realtime-2';

/**
 * OpenAI voice id used by the Realtime API. Picks from the 8-voice
 * lineup: alloy / ash / ballad / coral / echo / sage / shimmer / verse.
 * 'verse' tested as the most natural for Korean during design review.
 */
export const VOICE_OPENAI_VOICE = 'verse';

/**
 * Per-org cumulative daily voice usage limit, in seconds. Once an org's
 * voice_sessions duration_sec sum for today (UTC) hits this, /ephemeral
 * returns 429 quota_exceeded. 10 minutes = 600s.
 */
export const VOICE_DAILY_LIMIT_SEC = 600;

/** Locale used for instructions when the user locale is not provided. */
export const VOICE_DEFAULT_LOCALE: 'ko' | 'en' = 'ko';
