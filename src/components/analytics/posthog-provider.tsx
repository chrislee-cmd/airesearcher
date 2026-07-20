'use client';

import { useEffect } from 'react';
import { initPostHog, isPostHogReady, posthog } from '@/lib/analytics/posthog-client';
import { createClient } from '@/lib/supabase/client';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { isDeviceOptedOut, markDeviceOptedOut, readOptOutParam } from '@/lib/analytics/device-optout';

// Boots the PostHog SDK on mount and ties analytics identity to the Supabase
// session (analytics 3/6). Without an `identify` call, `person_profiles:
// 'identified_only'` (set in posthog-client) means no Person is ever created,
// so anonymous events never roll up to a user — this listener is that link.
//
// Capture stays unconditional by design (see posthog-client / docs/DEBT.md);
// consent gating is deferred.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
    if (!isPostHogReady()) return; // no key (local dev / preview) — nothing to wire

    // Device-level opt-out, applied before any capture on this load. Handles
    // (1) a manual ?analytics_optout=1 / ?analytics_optin=1 toggle and (2) a
    // browser that a prior internal login already flagged. PostHog persists its
    // own opt-out state, so once opted out subsequent page loads suppress the
    // initial pageview automatically. See lib/analytics/device-optout.ts.
    const optOutChange = readOptOutParam();
    if (optOutChange === 'optout') {
      posthog.opt_out_capturing();
      console.info('[analytics] 이 브라우저는 애널리틱스 수집에서 제외됩니다 (opt-out).');
    } else if (optOutChange === 'optin') {
      posthog.opt_in_capturing();
      console.info('[analytics] 이 브라우저 애널리틱스 수집을 재개합니다 (opt-in).');
    } else if (isDeviceOptedOut()) {
      posthog.opt_out_capturing();
    }

    captureUtmAttribution();

    const supabase = createClient();
    let active = true;

    // 초기 세션 확인 + identify (새로고침/직접 진입 시 이미 로그인 상태 커버)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (session?.user) identifyUser(session.user);
    });

    // auth 변경 listener — 로그인 시 identify + session_login, 로그아웃 시 reset
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        identifyUser(session.user);
        // spec 2/6 event helper(@/lib/analytics/events)가 아직 main 에 없어
        // posthog.capture 로 직접 발화. provider 는 app_metadata.provider 를
        // 로그인 수단으로 기록 (google / email 등).
        posthog.capture('session_login', {
          method: session.user.app_metadata?.provider ?? 'unknown',
        });
      } else if (event === 'SIGNED_OUT') {
        posthog.reset(); // 익명으로 복귀 (다음 이벤트는 새 anonymous id)
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}

// UTM 파라미터를 landing 시 한 번 읽어 attribution 으로 stamp (analytics 4/6).
// PostHog SDK 는 `$initial_utm_*` / `$utm_*` / `$referrer` 를 자동 capture 하므로
// referrer 는 별도 코드가 필요 없다. 이 함수는 UTM 을 (1) first-touch person
// property (set_once — 재유입 시 초기 소스 유지) 와 (2) super property (register
// — 이 브라우저의 모든 이후 event 에 stamp) 로 추가해 attribution 을 명시적으로
// 보존한다. person_profiles:'identified_only' 라 set_once 는 유저가 identify 된
// 뒤에만 profile 에 반영되지만, 값은 SDK 가 안전하게 보관한다.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

function captureUtmAttribution() {
  if (typeof window === 'undefined') return;

  const params = new URL(window.location.href).searchParams;
  // spec 예시는 null 을 포함한 utm 객체를 그대로 넘기지만, null 을 super property 로
  // stamp 하면 모든 event 가 빈 utm 값을 달게 되므로 존재하는 키만 남긴다 (보수적 선택).
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }

  if (Object.keys(utm).length === 0) return; // UTM 없는 일반 방문 — no-op

  posthog.setPersonProperties(undefined, utm); // set_once: first-touch 유지
  posthog.register(utm); // 이 세션 이후 모든 event 에 super property 로 stamp
}

// user_id 를 distinct_id 로, email/created_at 을 person property 로 등록.
// org_id / plan 은 후속 spec (fetchProfile hook 재사용) 범위라 여기서는 제외.
function identifyUser(user: { id: string; email?: string | null; created_at?: string }) {
  // Internal (our own) account: tag the person as internal for the dashboard
  // "internal & test users" filter, then stop capturing on this browser for
  // good. We intentionally do NOT posthog.identify() an internal user — we
  // don't want to build a rich identity for excluded traffic. markDeviceOptedOut
  // also carries the exclusion to anonymous landing visits on this browser (the
  // whole point) and lets the Mixpanel provider read the same flag.
  //
  // Caveat (documented in the PR): under person_profiles:'identified_only' a
  // setPersonProperties before identify may not attach to a server-side person,
  // so the dashboard email-contains / IP filters are the reliable backstop.
  if (isSuperAdminEmail(user.email)) {
    posthog.setPersonProperties(undefined, { is_internal: true });
    posthog.opt_out_capturing();
    markDeviceOptedOut();
    return;
  }

  posthog.identify(user.id, {
    email: user.email ?? undefined,
    created_at: user.created_at,
  });
}
