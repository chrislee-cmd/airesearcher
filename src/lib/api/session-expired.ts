/**
 * Session-expiry signal — a tiny module-level store bridging the plain
 * fetch layer (non-React) to the <SessionExpiredModal /> mounted in the
 * (app) layout.
 *
 * Why this exists: the ghost-session bug (PR #597) only covered the
 * *explicit* sign-out path — `onAuthStateChange` fires SIGNED_OUT and the
 * AuthStateListener redirects. But when the server-side session simply
 * expires (JWT/cookie past TTL) the client's Supabase auth state can still
 * look "signed in", so no event fires; instead every `/api/*` call starts
 * returning 401 and the app fails silently. This store lets any fetch that
 * observes a 401 raise a single, explicit "session expired" signal that the
 * modal subscribes to.
 *
 * Deliberately framework-free (no React import) so it can be called from
 * `fetchWithAuth` or any other plain async code.
 */

// First-401-wins latch. Once tripped, further 401s are ignored so a burst
// of failing polls (workspace poll, probing streams, ...) can't stack
// multiple modals or re-arm the redirect timer. Matches the spec's
// `sessionExpiredHandled` guard.
let expired = false;

const listeners = new Set<() => void>();

/**
 * Mark the session as expired. Idempotent: only the first call notifies
 * subscribers; subsequent calls are no-ops. Safe to call from anywhere.
 */
export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of listeners) listener();
}

/** Current latched state — the modal's external-store snapshot. */
export function isSessionExpired(): boolean {
  return expired;
}

/**
 * Subscribe to the expiry signal. Returns an unsubscribe fn. Used by
 * <SessionExpiredModal /> via useSyncExternalStore.
 */
export function subscribeSessionExpired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reset the latch. Not used in the normal flow (a full-page redirect to
 * /login tears down all module state anyway) — exported for tests and for
 * any future in-place session-recovery path.
 */
export function resetSessionExpired(): void {
  expired = false;
}
