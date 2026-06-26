'use client';

import { useEffect, useState } from 'react';
import {
  CONSENT_VERSION,
  COOKIE_CONSENT_STORAGE_KEY,
} from '@/lib/consent';

// SSOT for cookie-banner consent state, surfaced to client components that
// need to gate side-effects (Mixpanel init, future analytics SDKs, etc.) on
// the user's choice. Reads from localStorage written by
// CookieConsentBanner; reacts to both cross-tab `storage` events and a
// same-tab custom event the banner dispatches after persisting.

export type ConsentState = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  // false = user has not yet seen / answered the banner. Treat as deny.
  decided: boolean;
};

const DEFAULT: ConsentState = {
  essential: true,
  analytics: false,
  marketing: false,
  decided: false,
};

// Custom DOM event so the banner can notify same-tab consumers immediately
// after writing localStorage — the native `storage` event only fires
// cross-tab. Keep the event name stable; settings UI that revokes consent
// in a future PR will dispatch the same event after rewriting storage.
export const CONSENT_CHANGED_EVENT = 'rm-consent-changed';

function readStored(): ConsentState {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as {
      analytics?: boolean;
      marketing?: boolean;
      version?: string;
    };
    if (parsed.version !== CONSENT_VERSION) return DEFAULT;
    return {
      essential: true,
      analytics: Boolean(parsed.analytics),
      marketing: Boolean(parsed.marketing),
      decided: true,
    };
  } catch {
    return DEFAULT;
  }
}

export function useConsent(): ConsentState {
  // SSR + first client render: default-deny so server/client markup matches
  // and no analytics fires before hydration reads the real choice.
  const [state, setState] = useState<ConsentState>(DEFAULT);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration external-storage probe; banner uses the same pattern
    setState(readStored());

    const onChange = () => setState(readStored());
    window.addEventListener('storage', onChange);
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    };
  }, []);

  return state;
}
