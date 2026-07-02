import { markSessionExpired } from './session-expired';

/**
 * `fetch` drop-in that watches for HTTP 401 and raises the global
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
  const res = await fetch(input, init);
  if (res.status === 401) {
    markSessionExpired();
  }
  return res;
}
