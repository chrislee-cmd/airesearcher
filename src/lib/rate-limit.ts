import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from '@/env';

// SEC-003 / SEC-019 (audit Phase 0). Application-level rate limit on top
// of network/CDN — Upstash Redis is shared across Vercel regions so the
// counter doesn't drift between Fluid Compute instances.
//
// Fail-closed: KV_REST_API_URL/TOKEN (the Vercel Marketplace Upstash REST
// creds) are required in env.ts, so the build fails without them rather than
// silently disabling the limiter. The former PR-SEC4b temporary fail-open
// gate (skip-when-env-missing) has been removed now that Upstash is
// provisioned — every call hits Redis.

type Window = `${number} s` | `${number} m` | `${number} h` | `${number} d`;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;
  redis = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN,
  });
  return redis;
}

// One Ratelimit instance per (limit, window) combination, cached so we
// don't pay the per-request construction cost. `slidingWindow` matches
// the spec — token bucket (`tokenBucket`) is reserved for future
// long-window org limits where we want refill semantics rather than
// rolling-window counting.
const limiters = new Map<string, Ratelimit>();

function getLimiter(
  prefix: string,
  limit: number,
  window: Window,
): Ratelimit {
  const cacheKey = `${prefix}:${limit}:${window}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;
  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `rl:${prefix}`,
    // Analytics so the Upstash dashboard surfaces hot keys without us
    // needing to ship our own counters.
    analytics: true,
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

export type RateLimitResult = {
  success: boolean;
  // Seconds until the next request slot opens. 0 when `success: true`.
  retryAfter: number;
  // Window remaining quota — useful for `X-RateLimit-Remaining` headers
  // (not currently surfaced but cheap to keep).
  remaining: number;
  limit: number;
};

/**
 * Check a single rate-limit key. `identifier` is the bucket (IP, user.id,
 * org.id, …) and `prefix` namespaces the limit so e.g. `auth` and `llm`
 * don't share a counter for the same user.
 */
export async function rateLimit(
  identifier: string,
  prefix: string,
  limit: number,
  window: Window,
): Promise<RateLimitResult> {
  const limiter = getLimiter(prefix, limit, window);
  const { success, reset, remaining } = await limiter.limit(identifier);
  const retryAfter = success
    ? 0
    : Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { success, retryAfter, remaining, limit };
}

/**
 * Check several limits at once and return the strictest verdict (first
 * failure wins). Used for the LLM endpoints which apply both a per-user
 * per-minute cap and a per-org daily cap.
 */
export async function rateLimitMany(
  checks: Array<{
    identifier: string;
    prefix: string;
    limit: number;
    window: Window;
  }>,
): Promise<RateLimitResult> {
  for (const check of checks) {
    const result = await rateLimit(
      check.identifier,
      check.prefix,
      check.limit,
      check.window,
    );
    if (!result.success) return result;
  }
  return { success: true, retryAfter: 0, remaining: 0, limit: 0 };
}

/**
 * Best-effort IP extraction from request headers. Falls back to `unknown`
 * so the limiter always has a non-empty key — better to over-bucket NAT'd
 * users together than to skip the check entirely.
 *
 * XFF first-hop trust is gated to Vercel (`env.VERCEL === '1'`)
 * where the platform guarantees the leftmost address is the real client.
 * In any other environment a client can forge `x-forwarded-for` / `x-real-ip`
 * to evade per-IP limits, so we deliberately decline to read those headers
 * outside Vercel and fall through to `unknown`.
 */
export function getClientIp(request: Request): string {
  if (env.VERCEL === '1') {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = request.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'unknown';
}

/**
 * Standard 429 response — matches the shape the frontend already
 * understands (`error` + `retry_after`). Sets `Retry-After` and the
 * informational `X-RateLimit-*` headers.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'rate_limited', retry_after: result.retryAfter }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    },
  );
}

// Path-specific limits. Tuned conservatively for the initial rollout per
// SEC-003 — adjust after watching Upstash analytics for a week.
export const LIMITS = {
  // Anonymous auth-adjacent traffic. Trial-init / sign-in flows.
  auth: { limit: 5, window: '1 m' as Window },
  // Public anonymous endpoints (scheduler booking page, translate
  // viewer). Higher cap because legitimate viewers poll.
  public: { limit: 30, window: '1 m' as Window },
  // Authenticated LLM calls per user-minute.
  llmPerUser: { limit: 30, window: '1 m' as Window },
  // Authenticated LLM calls per org-day. Catches a single org running
  // through many users.
  llmPerOrgDaily: { limit: 200, window: '1 d' as Window },
  // Catch-all for the remaining authenticated API surface.
  general: { limit: 100, window: '1 m' as Window },
} as const;

/**
 * Convenience wrapper used by API handlers. Applies the standard LLM
 * limits (per-user-minute + per-org-day when org is known). Returns
 * null when allowed, or a ready-to-return 429 Response when limited.
 *
 * `orgId` is optional because a few LLM handlers derive org from the
 * job row instead of the active session and don't have it on hand.
 * In that case we only enforce the per-user minute cap — the per-org
 * daily cap is best-effort.
 */
export async function checkLlmRateLimit(
  userId: string,
  orgId?: string | null,
): Promise<Response | null> {
  const checks: Array<{
    identifier: string;
    prefix: string;
    limit: number;
    window: Window;
  }> = [
    {
      identifier: userId,
      prefix: 'llm:user',
      limit: LIMITS.llmPerUser.limit,
      window: LIMITS.llmPerUser.window,
    },
  ];
  if (orgId) {
    checks.push({
      identifier: orgId,
      prefix: 'llm:org-daily',
      limit: LIMITS.llmPerOrgDaily.limit,
      window: LIMITS.llmPerOrgDaily.window,
    });
  }
  const result = await rateLimitMany(checks);
  if (result.success) return null;
  console.warn('[rate-limit] llm blocked', {
    userId,
    orgId,
    retryAfter: result.retryAfter,
  });
  return rateLimitResponse(result);
}
