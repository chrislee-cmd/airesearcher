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
//   - rate limit (`KV_REST_API_*` missing → previously allowed all)
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
    // Deployment git SHA, injected by Vercel. Optional (absent locally / in
    // test). Stamped onto rag_eval_runs so a metric snapshot is traceable to
    // the exact deploy — the A/B/C before/after comparison hinges on this.
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),

    // ── Required in production (build fails if missing) ──────────────
    CRON_SECRET: z.string().min(16),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-'),
    OPENAI_API_KEY: z.string().startsWith('sk-'),
    DEEPGRAM_API_KEY: z.string().min(20),
    DEEPGRAM_WEBHOOK_SECRET: z.string().min(16),
    GMAIL_USER: z.string().email(),
    GMAIL_APP_PASSWORD: z.string().min(8),

    // Upstash Redis (Vercel Marketplace) — required (fail-closed). The
    // integration injects the REST endpoint under the `KV_REST_API_*` names
    // (Vercel KV / Upstash marketplace convention); @upstash/redis consumes
    // them directly. rate-limit.ts enforces the app-level cost-abuse cap on
    // every LLM/STT route, so a missing var must fail the build rather than
    // silently disable the limiter. The integration must be provisioned
    // (prod/preview/dev) before deploying. (Was the optional
    // `UPSTASH_REDIS_REST_*` pair under PR-SEC4b's temporary fail-open window.)
    KV_REST_API_URL: z.string().url(),
    KV_REST_API_TOKEN: z.string().min(20),

    // ── Optional providers (graceful degradation at call site) ───────
    ELEVENLABS_API_KEY: z.string().min(20).optional(),
    ELEVENLABS_WEBHOOK_SECRET: z.string().min(16).optional(),
    TWELVELABS_API_KEY: z.string().min(20).optional(),
    TWELVELABS_ANALYZE_INDEX_ID: z.string().min(8).optional(),
    // Gemini — AI UT behavior-analytics vision post-processing (card 622). Reads
    // the screen recording natively (video-in) to infer quantitative interaction
    // events. Optional: if absent, analysis is skipped gracefully and the
    // session stays 'done' with a null behavior_metrics.
    GEMINI_API_KEY: z.string().min(20).optional(),

    LEMONSQUEEZY_API_KEY: z.string().min(20).optional(),
    // Legacy single-store env. When the dual-store vars below are unset,
    // these still drive both rails (treated as the KRW store) so we can
    // stage the dashboard split without a flag flip.
    LEMONSQUEEZY_STORE_ID: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET: z.string().min(16).optional(),
    // Dual-store split. Each Lemon Squeezy store maps to one payout
    // account: KRW → 메테오 KRW 국내, USD → 메테오 USD 외환. Variants
    // and webhook secret are per-store.
    //
    // 2026-07-13 리프라이스 env 키 규약 (441 LS 상품생성 스크립트가 이 키명으로
    // 값 출력): 수량 팩 `LEMONSQUEEZY_VARIANT_PACK_{MINI,STARTER,PLUS,PRO,MAX}_
    // {KRW,USD}` · 구독 `LEMONSQUEEZY_SUB_{SOLO,PLUS,PRO}_{KRW,USD}`. 구 팩 키
    // (STARTER/TEAM/STUDIO/ENTERPRISE)는 팩 재편으로 폐지.
    LEMONSQUEEZY_STORE_ID_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET_KRW: z.string().min(16).optional(),
    LEMONSQUEEZY_VARIANT_PACK_MINI_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_STARTER_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_PLUS_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_PRO_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_MAX_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_STORE_ID_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET_USD: z.string().min(16).optional(),
    LEMONSQUEEZY_VARIANT_PACK_MINI_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_STARTER_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_PLUS_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_PRO_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_VARIANT_PACK_MAX_USD: z.string().min(1).optional(),
    // 구독 variant (B1 이 소비 — 여기선 키 규약만 확정).
    LEMONSQUEEZY_SUB_SOLO_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PLUS_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PRO_KRW: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_SOLO_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PLUS_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PRO_USD: z.string().min(1).optional(),
    // 연간 구독 variant — 연간은 USD 전용(계좌이체·KRW 미제공). 1개월 무료.
    LEMONSQUEEZY_SUB_SOLO_ANNUAL_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PLUS_ANNUAL_USD: z.string().min(1).optional(),
    LEMONSQUEEZY_SUB_PRO_ANNUAL_USD: z.string().min(1).optional(),

    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),

    // Admin proxy — every recruiting publish lands in this account's
    // Drive instead of the requesting user's. Optional so local dev / PR
    // previews without the env keep working through the legacy per-user
    // OAuth path; production sets both keys to flip to proxy mode.
    GOOGLE_ADMIN_REFRESH_TOKEN: z.string().min(20).optional(),
    GOOGLE_ADMIN_EMAIL: z.string().email().optional(),

    // AES-256-GCM key for at-rest encryption of stored Google OAuth
    // refresh_tokens (user_google_oauth.refresh_token). 32 bytes,
    // base64-encoded (`openssl rand -base64 32` → 44 chars). Required
    // (fail-closed): a missing/short key must fail the build rather than
    // silently degrade to plaintext storage. Human action — register in
    // Vercel production / preview / development before merge.
    OAUTH_TOKEN_ENC_KEY: z.string().min(44),

    LIVEKIT_API_KEY: z.string().min(8).optional(),
    LIVEKIT_API_SECRET: z.string().min(8).optional(),
    LIVEKIT_URL: z.string().url().optional(),

    NAVER_CLIENT_ID: z.string().min(8).optional(),
    NAVER_CLIENT_SECRET: z.string().min(8).optional(),
    KAKAO_REST_API_KEY: z.string().min(8).optional(),
    YOUTUBE_API_KEY: z.string().min(8).optional(),
    DART_API_KEY: z.string().min(8).optional(),
    KCI_API_KEY: z.string().min(8).optional(),
    // Optional — raises the Semantic Scholar rate limit. Missing key still
    // works on the public tier, so the desk source has no envKeys gate.
    SEMANTIC_SCHOLAR_API_KEY: z.string().min(8).optional(),
    // Tavily web search — powers the 탑라인 drag-to-ask "웹 검색" mode.
    // Optional: when missing, the ask route rejects web-mode requests with
    // `web_search_unavailable` (interview mode keeps working).
    TAVILY_API_KEY: z.string().min(8).optional(),
    ECOS_API_KEY: z.string().min(8).optional(),
    KOSIS_API_KEY: z.string().min(8).optional(),
    // e-Stat (일본 통계포털 api.e-stat.go.jp) appId — 국내 KOSIS 의 일본 등가.
    // 무료 발급(https://www.e-stat.go.jp/api/). 미설정 시 e-Stat 소스 자동 비활성
    // (envKeys 게이트) — 다른 소스엔 영향 없음. 3환경 등록은 /api 스킬(사용자 액션).
    ESTAT_APP_ID: z.string().min(8).optional(),
    // EDINET (일본 전자공시 api.edinet-fss.go.jp v2) subscription key — 국내 DART 의
    // 일본 등가. EDINET API v2 는 발급받은 Subscription-Key 헤더를 요구한다(스펙은
    // "무료" 로 기술했으나 v2 는 키 필수 — 보수적으로 optional 로 추가). 미설정 시
    // EDINET 소스는 라이브 조회에서 401 → 사유를 담아 graceful skip(무음 0건 아님).
    EDINET_API_KEY: z.string().min(8).optional(),

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

    // Recipients for the interview failure-alert digest (comma-separated).
    // Optional — when unset the cron falls back to the super-admin allowlist
    // (src/lib/admin/superadmin.ts). Kept as a raw string (not email-validated
    // here) so the route can split + trim; empty entries are dropped there.
    INTERVIEW_ALERT_EMAILS: z.string().optional(),

    // Recipients for the product-wide error digest (comma-separated). Generalises
    // INTERVIEW_ALERT_EMAILS — the digest reads this first and falls back to
    // INTERVIEW_ALERT_EMAILS (backward-compat), then the super-admin allowlist.
    ERROR_ALERT_EMAILS: z.string().optional(),

    OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-translate'),
    OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-mini-transcribe'),

    // Live-caption VAD tuning (637). The moderated live-caption STT session
    // (caption-token route) over-segmented natural speech: server_vad committed
    // a segment after only 500ms of silence, so continuous speech shattered into
    // "저는 지금" / "어." fragments (one caption line per micro-pause). Raise the
    // silence window so segments span sentence/thought units. Kept as a string
    // (this env object is iterated as Record<string,string|undefined> elsewhere,
    // so numbers break that cast) — parsed at the route with Number().
    OPENAI_CAPTION_VAD_SILENCE_MS: z
      .string()
      .regex(/^\d+$/, 'must be a non-negative integer')
      .default('1500'),
    // Optionally switch the caption VAD to semantic_vad — segments on semantic
    // utterance completion instead of a fixed silence window, giving more natural
    // full-sentence captions where supported. Defaults to the known-good
    // server_vad; flip per-env to evaluate without a rebuild.
    OPENAI_CAPTION_VAD_MODE: z
      .enum(['server_vad', 'semantic_vad'])
      .default('server_vad'),
    // semantic_vad only — how eagerly a turn is closed. 'low' waits longest
    // (most complete sentences); 'high' cuts sooner. Ignored for server_vad.
    OPENAI_CAPTION_VAD_EAGERNESS: z
      .enum(['low', 'medium', 'high', 'auto'])
      .default('low'),

    // Custom translation TTS (single fixed voice). The realtime model's
    // audio uses dynamic voice adaptation with no voice selector, so we
    // re-synthesize the translated text through OpenAI TTS pinned to ONE
    // voice for consistency. Server-only so the client never picks the
    // voice. `alloy` is a neutral, androgynous default; override per-env.
    TRANSLATE_TTS_VOICE: z.string().default('alloy'),
    TRANSLATE_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
    // 2-voice slot mapping: distinct voices per capture slot so listeners
    // hear WHO is speaking (mic=host → A, tab=guest → B). These carry
    // CONTRASTING defaults (onyx = deep/low, shimmer = bright/high) so the
    // two-voice split works out of the box in dual-source sessions with no
    // env config — override per-env to taste. Only applied in the dual-source
    // (`both`) mode; single-source sessions use the base TRANSLATE_TTS_VOICE
    // (see translate-console.tsx). Server-only, same as the base voice.
    TRANSLATE_TTS_VOICE_MIC: z.string().default('onyx'),
    TRANSLATE_TTS_VOICE_TAB: z.string().default('shimmer'),

    // 'false' (string) disables LLM zero-retention. Default = enabled.
    LLM_ZERO_RETENTION: z.enum(['true', 'false']).default('true'),

    // 동시접속 정원 게이트 cap. 앱 진입 시 살아있는 세션이 이 수를 넘으면
    // 신규 진입은 대기열로 (가상 대기실). 안전밸브라 나중에 쉽게 상향 —
    // 어드민 테이블은 과함, env 로. 문자열로 두는 이유: 이 env 객체를
    // Record<string, string|undefined> 로 캐스팅해 순회하는 곳이 있어(provider
    // configured 체크 등) number 값을 넣으면 그 캐스팅이 깨진다. 게이트
    // 라우트가 사용 시점에 Number(env.CONCURRENCY_CAP) 로 파싱. 자릿수 + >0 검증만.
    CONCURRENCY_CAP: z
      .string()
      .regex(/^\d+$/, 'must be a non-negative integer')
      .refine((v) => Number(v) > 0, 'must be > 0')
      .default('5'),

    // PostHog dashboard "Share externally" embed URL for /admin/analytics.
    // Server-only (not NEXT_PUBLIC) — the iframe src is rendered by an RSC
    // gated to super-admins. Optional so local dev / previews without the
    // URL render the "not configured" notice instead of 500-ing.
    POSTHOG_EMBED_URL: z.string().url().optional(),

    // Secret token that unlocks the public read-only metrics view at
    // `/[locale]/status?key=<token>`. That route lives OUTSIDE the (app)
    // auth layer (login-independent, always-on wall/phone monitor) and
    // exposes the PII-free aggregate dashboard — so this token is its ONLY
    // gate. Optional so the route stays fail-closed: when unset the page
    // always notFound()s (no accidental public exposure before a real token
    // is provisioned). Human action — register a 24+ char random value in
    // Vercel production / preview / development via the /api skill.
    PUBLIC_DASHBOARD_TOKEN: z.string().min(24).optional(),
  },

  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(40),

    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    NEXT_PUBLIC_MIXPANEL_TOKEN: z.string().min(8).optional(),
    NEXT_PUBLIC_TRANSLATE_VIEWER_HOST: z.string().min(1).optional(),

    // Kill-switch for the custom fixed-voice TTS pipeline. Default `on`
    // (the fix is live). Set to `off` to fall back to the realtime model's
    // native (dynamic-voice) audio if the custom path ever regresses.
    // Client-readable because the console pipeline is where the divert
    // happens.
    NEXT_PUBLIC_TRANSLATE_CUSTOM_TTS: z.enum(['on', 'off']).default('on'),

    // PostHog product analytics. Optional so local dev / PR previews
    // without the keys keep working — the client init no-ops when the key
    // is absent (see src/lib/analytics/posthog-client.ts). Host defaults to
    // the US cloud ingest endpoint when unset.
    NEXT_PUBLIC_POSTHOG_KEY: z.string().startsWith('phc_').optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  },

  // Full destructure so this works on every runtime (Node, Edge, build).
  // Don't shortcut to spreading process.env — Next.js won't inline client
  // vars correctly without this explicit list.
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,

    CRON_SECRET: process.env.CRON_SECRET,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
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
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,

    LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY,
    LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID,
    LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
    LEMONSQUEEZY_STORE_ID_KRW: process.env.LEMONSQUEEZY_STORE_ID_KRW,
    LEMONSQUEEZY_WEBHOOK_SECRET_KRW: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_KRW,
    LEMONSQUEEZY_VARIANT_PACK_MINI_KRW: process.env.LEMONSQUEEZY_VARIANT_PACK_MINI_KRW,
    LEMONSQUEEZY_VARIANT_PACK_STARTER_KRW: process.env.LEMONSQUEEZY_VARIANT_PACK_STARTER_KRW,
    LEMONSQUEEZY_VARIANT_PACK_PLUS_KRW: process.env.LEMONSQUEEZY_VARIANT_PACK_PLUS_KRW,
    LEMONSQUEEZY_VARIANT_PACK_PRO_KRW: process.env.LEMONSQUEEZY_VARIANT_PACK_PRO_KRW,
    LEMONSQUEEZY_VARIANT_PACK_MAX_KRW: process.env.LEMONSQUEEZY_VARIANT_PACK_MAX_KRW,
    LEMONSQUEEZY_STORE_ID_USD: process.env.LEMONSQUEEZY_STORE_ID_USD,
    LEMONSQUEEZY_WEBHOOK_SECRET_USD: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_USD,
    LEMONSQUEEZY_VARIANT_PACK_MINI_USD: process.env.LEMONSQUEEZY_VARIANT_PACK_MINI_USD,
    LEMONSQUEEZY_VARIANT_PACK_STARTER_USD: process.env.LEMONSQUEEZY_VARIANT_PACK_STARTER_USD,
    LEMONSQUEEZY_VARIANT_PACK_PLUS_USD: process.env.LEMONSQUEEZY_VARIANT_PACK_PLUS_USD,
    LEMONSQUEEZY_VARIANT_PACK_PRO_USD: process.env.LEMONSQUEEZY_VARIANT_PACK_PRO_USD,
    LEMONSQUEEZY_VARIANT_PACK_MAX_USD: process.env.LEMONSQUEEZY_VARIANT_PACK_MAX_USD,
    LEMONSQUEEZY_SUB_SOLO_KRW: process.env.LEMONSQUEEZY_SUB_SOLO_KRW,
    LEMONSQUEEZY_SUB_PLUS_KRW: process.env.LEMONSQUEEZY_SUB_PLUS_KRW,
    LEMONSQUEEZY_SUB_PRO_KRW: process.env.LEMONSQUEEZY_SUB_PRO_KRW,
    LEMONSQUEEZY_SUB_SOLO_USD: process.env.LEMONSQUEEZY_SUB_SOLO_USD,
    LEMONSQUEEZY_SUB_PLUS_USD: process.env.LEMONSQUEEZY_SUB_PLUS_USD,
    LEMONSQUEEZY_SUB_PRO_USD: process.env.LEMONSQUEEZY_SUB_PRO_USD,
    LEMONSQUEEZY_SUB_SOLO_ANNUAL_USD: process.env.LEMONSQUEEZY_SUB_SOLO_ANNUAL_USD,
    LEMONSQUEEZY_SUB_PLUS_ANNUAL_USD: process.env.LEMONSQUEEZY_SUB_PLUS_ANNUAL_USD,
    LEMONSQUEEZY_SUB_PRO_ANNUAL_USD: process.env.LEMONSQUEEZY_SUB_PRO_ANNUAL_USD,

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ADMIN_REFRESH_TOKEN: process.env.GOOGLE_ADMIN_REFRESH_TOKEN,
    GOOGLE_ADMIN_EMAIL: process.env.GOOGLE_ADMIN_EMAIL,
    OAUTH_TOKEN_ENC_KEY: process.env.OAUTH_TOKEN_ENC_KEY,

    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    LIVEKIT_URL: process.env.LIVEKIT_URL,

    NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
    KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    DART_API_KEY: process.env.DART_API_KEY,
    KCI_API_KEY: process.env.KCI_API_KEY,
    SEMANTIC_SCHOLAR_API_KEY: process.env.SEMANTIC_SCHOLAR_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ECOS_API_KEY: process.env.ECOS_API_KEY,
    KOSIS_API_KEY: process.env.KOSIS_API_KEY,
    ESTAT_APP_ID: process.env.ESTAT_APP_ID,
    EDINET_API_KEY: process.env.EDINET_API_KEY,

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
    INTERVIEW_ALERT_EMAILS: process.env.INTERVIEW_ALERT_EMAILS,
    ERROR_ALERT_EMAILS: process.env.ERROR_ALERT_EMAILS,

    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL,
    OPENAI_CAPTION_VAD_SILENCE_MS: process.env.OPENAI_CAPTION_VAD_SILENCE_MS,
    OPENAI_CAPTION_VAD_MODE: process.env.OPENAI_CAPTION_VAD_MODE,
    OPENAI_CAPTION_VAD_EAGERNESS: process.env.OPENAI_CAPTION_VAD_EAGERNESS,
    TRANSLATE_TTS_VOICE: process.env.TRANSLATE_TTS_VOICE,
    TRANSLATE_TTS_MODEL: process.env.TRANSLATE_TTS_MODEL,
    TRANSLATE_TTS_VOICE_MIC: process.env.TRANSLATE_TTS_VOICE_MIC,
    TRANSLATE_TTS_VOICE_TAB: process.env.TRANSLATE_TTS_VOICE_TAB,
    LLM_ZERO_RETENTION: process.env.LLM_ZERO_RETENTION,
    CONCURRENCY_CAP: process.env.CONCURRENCY_CAP,
    POSTHOG_EMBED_URL: process.env.POSTHOG_EMBED_URL,
    PUBLIC_DASHBOARD_TOKEN: process.env.PUBLIC_DASHBOARD_TOKEN,

    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_MIXPANEL_TOKEN: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
    NEXT_PUBLIC_TRANSLATE_VIEWER_HOST:
      process.env.NEXT_PUBLIC_TRANSLATE_VIEWER_HOST,
    NEXT_PUBLIC_TRANSLATE_CUSTOM_TTS:
      process.env.NEXT_PUBLIC_TRANSLATE_CUSTOM_TTS,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
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
