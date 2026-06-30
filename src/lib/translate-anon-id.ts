// Stable anonymous viewer id for the live-interpretation share flow.
//
// A viewer who opens /live/<token> needs a stable handle so the host's
// listener panel can tell "the same browser refreshed" from "a new
// listener joined". We mint a UUID on first visit and keep it in
// localStorage, so the same browser always reports the same id while a
// different browser (or incognito) gets a fresh one. This is presence
// metadata only — never an auth identity.

const STORAGE_KEY = 'translate-anon-id';

// SSR-safe + private-mode-safe: localStorage can throw (Safari private
// mode) or be absent (server render). On any failure we fall back to a
// per-call ephemeral id so the caller still gets *something* usable —
// it just won't survive a refresh.
export function getTranslateAnonId(): string {
  if (typeof window === 'undefined') return ephemeralId();
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = ephemeralId();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return ephemeralId();
  }
}

function ephemeralId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Very old browsers without crypto.randomUUID — good enough for a
    // best-effort presence handle.
    return `anon-${Math.random().toString(36).slice(2, 10)}`;
  }
}
