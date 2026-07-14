'use client';

import { useEffect } from 'react';

// First-party landing beacon. Mounted on the locale root landing page, it
// fires one fire-and-forget POST to /api/track/landing after the browser is
// idle — referrer + UTM params + a first-party localStorage session_id. It
// renders nothing and never blocks paint: all work runs in an effect, off the
// critical render path, and the request is fully best-effort (failures are
// swallowed). No third-party cookies, no raw IP (country is derived server-
// side from the Vercel header).

const SESSION_KEY = 'rc_landing_session';
// Self-visit opt-out: when this browser has set the skip flag (via the
// /admin/analytics toggle), the beacon never fires — keeps super-admin's own
// incognito / logged-out landing visits out of the count.
const SKIP_KEY = 'rc_landing_skip_beacon';

function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // Private mode / storage disabled — fall back to an ephemeral id so the
    // visit still records (just can't distinguish returning visitors).
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function LandingBeacon() {
  useEffect(() => {
    const send = () => {
      try {
        // Self-visit opt-out: this browser opted out of landing tracking, so
        // don't fire. Inside the existing try/catch so a storage failure
        // (private mode) can never throw into the page.
        if (
          typeof window !== 'undefined' &&
          localStorage.getItem(SKIP_KEY) === 'true'
        ) {
          return;
        }
        const params = new URLSearchParams(window.location.search);
        const payload = {
          session_id: getSessionId(),
          path: window.location.pathname,
          referrer: document.referrer || null,
          utm_source: params.get('utm_source'),
          utm_medium: params.get('utm_medium'),
          utm_campaign: params.get('utm_campaign'),
          utm_term: params.get('utm_term'),
          utm_content: params.get('utm_content'),
        };
        // keepalive lets the POST complete even if the user navigates away
        // immediately after landing.
        void fetch('/api/track/landing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // never let tracking throw into the page
      }
    };

    // Defer to idle so the beacon never competes with landing render.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(send);
    } else {
      const t = setTimeout(send, 1200);
      return () => clearTimeout(t);
    }
  }, []);

  return null;
}
