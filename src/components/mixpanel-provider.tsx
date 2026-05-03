'use client';

import { useEffect } from 'react';
import mixpanel from 'mixpanel-browser';

let initialized = false;

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (!initialized) return;
  mixpanel.track(event, props);
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !initialized) return;
  mixpanel.identify(userId);
  if (traits) mixpanel.people.set(traits);
}

export function MixpanelProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
    if (!token || initialized) return;
    mixpanel.init(token, {
      track_pageview: 'full-url',
      persistence: 'localStorage',
      autocapture: true,
    });
    initialized = true;
  }, []);
  return <>{children}</>;
}
