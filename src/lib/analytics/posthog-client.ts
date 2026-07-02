import posthog from 'posthog-js';
import { env } from '@/env';

// Module-level guard so init runs at most once per page load even if the
// provider effect re-fires (fast refresh). Mirrors mixpanel-provider.tsx.
let initialized = false;

// Lazily boots the PostHog browser SDK. No-op when:
//   - called during SSR (no window)
//   - NEXT_PUBLIC_POSTHOG_KEY is unset (local dev / previews without the env)
//   - already initialized this page load
// Option values come straight from the analytics-posthog-setup spec.
//
// NOTE: capture is unconditional — no consent gate yet (deferred, see
// docs/DEBT.md). Revisit before EU-heavy scale.
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
    // Surveys 활성 (feedback-posthog-surveys-setup). default 도 false 지만
    // 명시적으로 두어 SDK 가 load 후 대시보드 survey 를 auto-fetch → target
    // 매칭 시 popup 자동 노출하도록 보장. survey 정의/targeting/launch 는
    // PostHog 대시보드에서 (Surveys → New Survey). NPS + 기능 피드백 수집.
    disable_surveys: false,
    loaded: () => {
      // Surveys 는 loaded 직후 auto-fetch 됨. dev 에서만 활성 확인 로그.
      if (process.env.NODE_ENV === 'development') {
        console.log('[posthog] surveys enabled (auto-fetch on load)');
      }
    },
  });
  initialized = true;
}

// Lets callers (e.g. the auth-listener provider) skip identify/capture/reset
// when the SDK never booted — no key on local dev / previews. Mirrors the
// module-level guard mixpanel-provider.tsx keeps for the same reason.
export function isPostHogReady() {
  return initialized;
}

export { posthog };
