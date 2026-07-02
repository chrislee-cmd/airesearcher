import posthog from 'posthog-js';
import { env } from '@/env';

// Module-level guard so init runs at most once per page load even if the
// provider effect re-fires (consent flips, fast refresh). Mirrors the
// mixpanel-provider.tsx pattern.
let initialized = false;

// Lazily boots the PostHog browser SDK. No-op when:
//   - called during SSR (no window)
//   - NEXT_PUBLIC_POSTHOG_KEY is unset (local dev / previews without the env)
//   - already initialized this page load
// Option values come straight from the analytics-posthog-setup spec.
export function initPostHog() {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  posthog.init(key, {
    api_host: env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    capture_pageview: true, // 자동 pageview
    capture_pageleave: true, // 자동 pageleave (체류시간 계산 base)
    autocapture: true, // 클릭/폼 자동 캡처 (초기 안전, 이후 refine 가능)
    person_profiles: 'identified_only', // 익명 유저 profile 생성 X (비용 절감)
    disable_session_recording: false, // session recording 활성 (무료 포함)
    session_recording: {
      maskAllInputs: true, // 입력 필드 masking (PII 보호)
    },
  });
  initialized = true;
}

// Consent orchestration. The cookie banner (PR-SEC8) gates every analytics
// SDK on the user's `analytics` choice; use-consent.ts explicitly calls out
// "future analytics SDKs" as consumers. We only send anything to PostHog
// after an explicit grant, and stop (opt-out + reset identity) on revoke.
export function setPostHogConsent(granted: boolean) {
  if (typeof window === 'undefined') return;
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;

  if (granted) {
    initPostHog();
    if (!initialized) return;
    try {
      posthog.opt_in_capturing();
    } catch {
      // SDK can throw when storage is unavailable; opt-in is best-effort.
    }
    return;
  }

  // Pre-decision or explicit revoke. Only act if we already booted this
  // session, otherwise there is nothing to tear down.
  if (!initialized) return;
  try {
    posthog.opt_out_capturing();
    posthog.reset();
  } catch {
    // see note above
  }
}

export { posthog };
