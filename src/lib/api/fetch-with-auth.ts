import { createClient } from '@/lib/supabase/client';
import { markSessionExpired } from './session-expired';

// Preemptive-refresh tuning. We refresh the Supabase session *before* it
// lapses so long idle stretches (open a widget, wander off, come back) don't
// leave a stale JWT that turns every `/api/*` call into a 401. Two guards keep
// this from hammering GoTrue: only when the token is near expiry, and at most
// once per minute regardless of how many fetches fire.
const REFRESH_INTERVAL_MS = 60_000; // at most one refresh attempt per minute
const REFRESH_MARGIN_MS = 5 * 60_000; // refresh once the token is within 5 min of expiry

// Module-scoped throttle. Shared across every fetchWithAuth caller so a burst
// of concurrent polls (workspace poll, probing streams, ...) collapses to a
// single refresh attempt.
let lastRefreshAt = 0;

/**
 * Best-effort preemptive session refresh, run just before each authed fetch.
 *
 * Reads the current session locally (no network) and only calls
 * `refreshSession` — which hits `/auth/v1/token?grant_type=refresh_token` — when
 * the access token is within REFRESH_MARGIN_MS of expiry and the throttle
 * window has elapsed. Any error is swallowed: if the refresh fails the request
 * still goes out and the 401 defense line below (markSessionExpired) catches a
 * genuinely dead session. This is a UX optimization, not a security gate, so it
 * must never block or throw into the caller.
 */
async function ensureFreshSession(): Promise<void> {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAtMs - now < REFRESH_MARGIN_MS) {
      // Set the throttle before awaiting so concurrent callers short-circuit
      // instead of all firing their own refresh.
      lastRefreshAt = now;
      await supabase.auth.refreshSession();
    }
  } catch {
    // Swallow — the request proceeds and the 401 path handles a dead session.
  }
}

/**
 * `fetch` drop-in that (1) preemptively refreshes a near-expiry session so it
 * doesn't lapse mid-use, and (2) watches for HTTP 401 and raises the global
 * session-expiry signal so <SessionExpiredModal /> can surface an explicit
 * "your session expired, sign in again" prompt instead of the app failing
 * silently (the P0 this hotfix targets).
 *
 * Behavior is otherwise identical to `fetch`: the Response is always
 * returned unchanged (including on 401) so existing call-site handling —
 * `res.ok` checks, `res.status === 401` branches, `res.json()` — keeps
 * working. This wrapper is purely additive.
 *
 * 401 specifically means "unauthenticated" (expired/absent session).
 * Resource-level permission denials use 403, so this does not fire on
 * those. The `markSessionExpired` latch also ensures the modal shows at
 * most once no matter how many 401s a burst produces.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  await ensureFreshSession();
  const res = await fetch(input, init);
  if (res.status === 401) {
    markSessionExpired();
  }
  return res;
}
