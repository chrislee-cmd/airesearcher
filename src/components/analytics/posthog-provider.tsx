'use client';

import { useEffect } from 'react';
import { initPostHog, isPostHogReady, posthog } from '@/lib/analytics/posthog-client';
import { createClient } from '@/lib/supabase/client';

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

// user_id 를 distinct_id 로, email/created_at 을 person property 로 등록.
// org_id / plan 은 후속 spec (fetchProfile hook 재사용) 범위라 여기서는 제외.
function identifyUser(user: { id: string; email?: string | null; created_at?: string }) {
  posthog.identify(user.id, {
    email: user.email ?? undefined,
    created_at: user.created_at,
  });
}
