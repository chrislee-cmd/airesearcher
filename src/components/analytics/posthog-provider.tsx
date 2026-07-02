'use client';

import { useEffect } from 'react';
import { setPostHogConsent } from '@/lib/analytics/posthog-client';
import { useConsent } from '@/hooks/use-consent';

// Mounts the PostHog SDK, gated on the user's analytics consent. `useConsent`
// default-denies on SSR + first paint, so no network call to posthog.com
// happens before an explicit grant. Re-runs on consent changes so a later
// grant boots the SDK and a revoke opts out without a reload.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { analytics } = useConsent();

  useEffect(() => {
    setPostHogConsent(analytics);
  }, [analytics]);

  return <>{children}</>;
}
