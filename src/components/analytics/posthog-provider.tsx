'use client';

import { useEffect } from 'react';
import { initPostHog } from '@/lib/analytics/posthog-client';

// Boots the PostHog SDK on mount. Unconditional by design (analytics 1/6):
// we prioritize full capture now and defer consent gating until scale makes
// it worth wiring — tracked in docs/DEBT.md. `initPostHog` no-ops when the
// key is unset (local dev / previews) so this stays safe there.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  return <>{children}</>;
}
