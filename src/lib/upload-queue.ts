// Client-side upload throttling — the antidote to the interview-upload 429
// self-DoS. The batch upload pipeline used to fire one convert POST per file
// via Promise.all; N files → N concurrent LLM calls → the app's own per-user
// rate limit (checkLlmRateLimit, 30/min) blocks the overflow as 429 and the
// whole batch fails. These two helpers replace that with a bounded queue plus
// retry-after backoff so a large batch drains gracefully over several minutes
// instead of self-flooding.
//
// Both are framework-agnostic (no React) and run in the browser only.

/**
 * Run `worker` over `items` with at most `limit` promises in flight at once.
 * Results are returned in the original order. A worker that rejects propagates
 * (callers that want per-item isolation should catch inside the worker, which
 * is exactly what the upload hooks do).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Math.max(1, Math.min(limit, items.length));
  async function runner(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: runners }, () => runner()));
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RateLimitRetryOptions = {
  // Max number of RETRIES on 429 (so total attempts = retries + 1).
  retries?: number;
  // Upper bound on any single wait, in ms. Caps a hostile Retry-After too.
  maxDelayMs?: number;
  // Notified right before each backoff wait so the UI can show "retrying"
  // instead of looking frozen. attempt is 1-based.
  onRetry?: (info: { attempt: number; waitMs: number }) => void;
};

const DEFAULT_RETRIES = 5;
const DEFAULT_MAX_DELAY_MS = 60_000;

/**
 * fetch() that transparently retries on HTTP 429, honouring the server's
 * `Retry-After` header (seconds — set by rateLimitResponse in
 * src/lib/rate-limit.ts). Falls back to exponential backoff when the header is
 * missing/unparseable. A small jitter spreads a burst of queued files so they
 * don't all re-fire on the same tick and re-trip the limit together.
 *
 * `init.body` must be re-readable across attempts — FormData and string bodies
 * are (a ReadableStream body would not be). The two upload hooks only pass
 * those, so retrying is safe.
 *
 * Returns the final Response. If retries are exhausted the last 429 is
 * returned as-is for the caller to handle (they already treat !res.ok as a
 * per-file error), so this never masks a persistent limit as success.
 */
export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: RateLimitRetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= retries) return res;

    const headerVal = res.headers.get('retry-after');
    const retryAfterSec = headerVal ? Number(headerVal) : NaN;
    const baseMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : 1000 * 2 ** attempt;
    const jitterMs = Math.floor(Math.random() * 500);
    const waitMs = Math.min(maxDelayMs, baseMs) + jitterMs;
    opts.onRetry?.({ attempt: attempt + 1, waitMs });
    await sleep(waitMs);
  }
}
