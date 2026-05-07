'use client';

import { useEffect } from 'react';
import mixpanel from 'mixpanel-browser';
import { createClient } from '@/lib/supabase/client';

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
    if (!token) return;
    if (!initialized) {
      mixpanel.init(token, {
        track_pageview: 'full-url',
        persistence: 'localStorage',
        autocapture: true,
      });
      initialized = true;
    }

    // Tie all subsequent events to the signed-in user. We set both an
    // identify (for distinct_id continuity) and people traits (so the
    // user shows up in Mixpanel with email).
    const supabase = createClient();
    let active = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active || !user?.id) return;
      identify(user.id, { $email: user.email ?? undefined });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user;
      if (event === 'SIGNED_OUT') {
        if (typeof window !== 'undefined' && initialized) mixpanel.reset();
        return;
      }
      if (u?.id) identify(u.id, { $email: u.email ?? undefined });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return <>{children}</>;
}
