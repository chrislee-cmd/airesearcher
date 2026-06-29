// PR-SEC21 — env validation (fail-closed).
//
// Single source of truth for every process.env.* read in this app.
// Required vars are validated at build time via @t3-oss/env-nextjs:
// production deploys cannot ship without them. Optional vars validate the
// shape (e.g. URL, min length) when set, and stay `undefined` when missing
// so call sites can keep degrading gracefully.
//
// Why fail-closed:
//   - cron auth (`CRON_SECRET` missing → previously skipped auth entirely)
//   - rate limit (`UPSTASH_REDIS_REST_*` missing → previously allowed all)
//   - silent prod regressions ("env line dropped" with zero log signal)
//
// Rules for adding a new env:
//   1. Add to the `server` or `client` schema below with the right zod type
//   2. Add the matching line to `runtimeEnv`
//   3. Add the matching line to `.env.local.example`
//   4. Add to Vercel (production / preview / development) before deploy
//   5. Read it via `env.X` — never `process.env.X` directly in app code

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // Vercel platform-injected. Treated as optional because we run locally
    // (no Vercel context) and in test (no Vercel context). The `VERCEL`
    // flag is the gate that lets us trust XFF in rate-limit.ts.
    VERCEL: z.string().optional(),
    VERCEL_URL: z.string().optional(),

    // ── Required in production (build fails if missing) ──────────────
    CRON_SECRET: z.string().min(16),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-'),
    OPENAI_API_KEY: z.string().startsWith('sk-'),
    DEEPGRAM_API_KEY: z.string().min(20),
    DEEPGRAM_WEBHOOK_SECRET: z.string().min(16),
    GMAIL_USER: z.string().email(),
    GMAIL_APP_PASSWORD: z.string().min(8),

    // ── Optional providers (graceful degradation at call site) ───────
    // PR-SEC4b — Upstash is optional until the Vercel Marketplace
    // integration is added. When missing, rate-limit.ts fails open with
    // a one-shot warning. Restore to required (`z.string().url()` /
    // `.min(20)`) once Upstash is provisioned in prod.
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(20).optional(),

    ELEVENLABS_API_KEY: z.string().min(20).optional(),
    ELEVENLABS_WEBHOOK_SECRET: z.string().min(16).optional(),
    TWELVELABS_API_KEY: z.string().min(20).optional(),
    TWELVELABS_ANALYZE_INDEX_ID: z.string().min(8).optional(),

    LEMONSQUEEZY_API_KEY: z.string().min(20).optional(),
    // Legacy single-store env. When the dual-store vars below are unset,
    // these still drive both rails (treated as the KRW store) so we can
    // stage the dashboard split without a flag flip.
    LEMONSQUEEZY_STORE_ID: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET: z.string().min(16).optional(),
    LEMONSQUEEZY_VARIANT_STARTER: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_TEAM: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_STUDIO: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_ENTERPRISE: z.string().min(1).optional(),
    // Dual-store split. Each Lemon Squeezy store maps to one payout
    // account: KRW → 메테오 KRW 국내, USD → 메테오 USD 외환. Variants
    // and webhook secret are per-store.
    LEMONSQUEEZY_STORE_ID_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET_KRW: z.string().min(16).optional(),
    LEMONSQUEEZY_VARIANT_STARTER_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_TEAM_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_STUDIO_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_ENTERPRISE_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_STORE_ID_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET_USD: z.string().min(16).optional(),
    LEMONSQUEEZY_VARIANT_STARTER_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_TEAM_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_STUDIO_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_ENTERPRISE_USD: z.string().min(1).optional(),

    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),

    // Admin proxy — every recruiting publish lands in this account's
    // Drive instead of the requesting user's. Optional so local dev / PR
    // previews without the env keep working through the legacy per-user
    // OAuth path; production sets both keys to flip to proxy mode.
    GOOGLE_ADMIN_REFRESH_TOKEN: z.string().min(20).optional(),
    GOOGLE_ADMIN_EMAIL: z.string().email().optional(),

    LIVEKIT_API_KEY: z.string().min(8).optional(),
    LIVEKIT_API_SECRET: z.string().min(8).optional(),
    LIVEKIT_URL: z.string().url().optional(),

    NAVER_CLIENT_ID: z.string().min(8).optional(),
    NAVER_CLIENT_SECRET: z.string().min(8).optional(),
    KAKAO_REST_API_KEY: z.string().min(8).optional(),
    YOUTUBE_API_KEY: z.string().min(8).optional(),

    NOTION_API_TOKEN: z.string().min(8).optional(),
    NOTION_CLIENT_ID: z.string().min(8).optional(),
    NOTION_CLIENT_SECRET: z.string().min(8).optional(),
    NOTION_REDIRECT_URI: z.string().url().optional(),

    WORDPRESS_API_URL: z.string().url().optional(),

    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(16).optional(),
    ANTHROPIC_ADMIN_KEY: z.string().startsWith('sk-').optional(),
    OPENAI_ADMIN_KEY: z.string().startsWith('sk-').optional(),
    SUPABASE_ACCESS_TOKEN: z.string().min(20).optional(),

    BILLING_BANK_NAME: z.string().min(1).optional(),
    BILLING_ACCOUNT_NUMBER: z.string().min(1).optional(),
    BILLING_ACCOUNT_HOLDER: z.string().min(1).optional(),

    INQUIRY_TO_EMAIL: z.string().email().default('chris.lee@meteor-research.com'),
    QUOTE_TO_EMAIL: z.string().email().default('chris.lee@meteor-research.com'),

    OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-translate'),
    OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-mini-transcribe'),

    // 'false' (string) disables LLM zero-retention. Default = enabled.
    LLM_ZERO_RETENTION: z.enum(['true', 'false']).default('true'),
  },

  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(40),

    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    NEXT_PUBLIC_MIXPANEL_TOKEN: z.string().min(8).optional(),
    NEXT_PUBLIC_TRANSLATE_VIEWER_HOST: z.string().min(1).optional(),
  },

  // Full destructure so this works on every runtime (Node, Edge, build).
  // Don't shortcut to spreading process.env — Next.js won't inline client
  // vars correctly without this explicit list.
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,

    CRON_SECRET: process.env.CRON_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    DEEPGRAM_WEBHOOK_SECRET: process.env.DEEPGRAM_WEBHOOK_SECRET,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,

    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_WEBHOOK_SECRET: process.env.ELEVENLABS_WEBHOOK_SECRET,
    TWELVELABS_API_KEY: process.env.TWELVELABS_API_KEY,
    TWELVELABS_ANALYZE_INDEX_ID: process.env.TWELVELABS_ANALYZE_INDEX_ID,

    LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY,
    LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID,
    LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
    LEMONSQUEEZY_VARIANT_STARTER: process.env.LEMONSQUEEZY_VARIANT_STARTER,
    LEMONSQUEEZY_VARIANT_TEAM: process.env.LEMONSQUEEZY_VARIANT_TEAM,
    LEMONSQUEEZY_VARIANT_STUDIO: process.env.LEMONSQUEEZY_VARIANT_STUDIO,
    LEMONSQUEEZY_VARIANT_ENTERPRISE: process.env.LEMONSQUEEZY_VARIANT_ENTERPRISE,
    LEMONSQUEEZY_STORE_ID_KRW: process.env.LEMONSQUEEZY_STORE_ID_KRW,
    LEMONSQUEEZY_WEBHOOK_SECRET_KRW: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_KRW,
    LEMONSQUEEZY_VARIANT_STARTER_KRW: process.env.LEMONSQUEEZY_VARIANT_STARTER_KRW,
    LEMONSQUEEZY_VARIANT_TEAM_KRW: process.env.LEMONSQUEEZY_VARIANT_TEAM_KRW,
    LEMONSQUEEZY_VARIANT_STUDIO_KRW: process.env.LEMONSQUEEZY_VARIANT_STUDIO_KRW,
    LEMONSQUEEZY_VARIANT_ENTERPRISE_KRW: process.env.LEMONSQUEEZY_VARIANT_ENTERPRISE_KRW,
    LEMONSQUEEZY_STORE_ID_USD: process.env.LEMONSQUEEZY_STORE_ID_USD,
    LEMONSQUEEZY_WEBHOOK_SECRET_USD: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_USD,
    LEMONSQUEEZY_VARIANT_STARTER_USD: process.env.LEMONSQUEEZY_VARIANT_STARTER_USD,
    LEMONSQUEEZY_VARIANT_TEAM_USD: process.env.LEMONSQUEEZY_VARIANT_TEAM_USD,
    LEMONSQUEEZY_VARIANT_STUDIO_USD: process.env.LEMONSQUEEZY_VARIANT_STUDIO_USD,
    LEMONSQUEEZY_VARIANT_ENTERPRISE_USD: process.env.LEMONSQUEEZY_VARIANT_ENTERPRISE_USD,

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ADMIN_REFRESH_TOKEN: process.env.GOOGLE_ADMIN_REFRESH_TOKEN,
    GOOGLE_ADMIN_EMAIL: process.env.GOOGLE_ADMIN_EMAIL,

    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    LIVEKIT_URL: process.env.LIVEKIT_URL,

    NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
    KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,

    NOTION_API_TOKEN: process.env.NOTION_API_TOKEN,
    NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
    NOTION_REDIRECT_URI: process.env.NOTION_REDIRECT_URI,

    WORDPRESS_API_URL: process.env.WORDPRESS_API_URL,

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    ANTHROPIC_ADMIN_KEY: process.env.ANTHROPIC_ADMIN_KEY,
    OPENAI_ADMIN_KEY: process.env.OPENAI_ADMIN_KEY,
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN,

    BILLING_BANK_NAME: process.env.BILLING_BANK_NAME,
    BILLING_ACCOUNT_NUMBER: process.env.BILLING_ACCOUNT_NUMBER,
    BILLING_ACCOUNT_HOLDER: process.env.BILLING_ACCOUNT_HOLDER,

    INQUIRY_TO_EMAIL: process.env.INQUIRY_TO_EMAIL,
    QUOTE_TO_EMAIL: process.env.QUOTE_TO_EMAIL,

    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL,
    LLM_ZERO_RETENTION: process.env.LLM_ZERO_RETENTION,

    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_MIXPANEL_TOKEN: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
    NEXT_PUBLIC_TRANSLATE_VIEWER_HOST:
      process.env.NEXT_PUBLIC_TRANSLATE_VIEWER_HOST,
  },

  // Treat `FOO=` (empty string) the same as missing. Without this, a
  // forgotten value in .env.local could pass the schema as `''`.
  emptyStringAsUndefined: true,

  // Escape hatch for non-runtime contexts (Docker image builds, codemod
  // scripts) where envs are deliberately not present. Vercel never sets
  // this — prod builds always run full validation.
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.SKIP_ENV_VALIDATION === 'true',
});
