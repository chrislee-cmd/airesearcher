'use client';

/* ────────────────────────────────────────────────────────────────────
   OnboardingTooltip — 위젯 서브헤더의 설정(⚙)/업로드(📤) 버튼에 처음 붙는
   1회성 안내 말풍선. "여기를 눌러 시작 조건을 설정하세요" 처럼 첫 사용자가
   무엇을 먼저 해야 하는지 드러낸다.

   동작:
     - anchor(children) 아래에 말풍선을 띄운다.
     - id 별 localStorage(`onboarding-dismissed:<id>`) 로 1회 dismiss 를 기록 —
       이미 본 위젯은 다시 안 뜬다.
     - × 클릭 or anchor 클릭(onAnchorClick) 시 dismiss.

   SSR: localStorage 는 클라이언트에만 있으므로 서버/첫 렌더에서는 dismissed
   로 취급해 숨긴다(hydrate mismatch 방지). 클라이언트 스냅샷은
   useSyncExternalStore 로 localStorage 를 읽어 실제 dismiss 여부를 결정 —
   effect 안 setState (cascading render) 를 피한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';

function dismissKey(id: string) {
  return `onboarding-dismissed:${id}`;
}

// localStorage 는 이 컴포넌트 밖에서 바뀌지 않으므로 구독은 no-op.
function subscribe() {
  return () => {};
}

export type OnboardingTooltipProps = {
  // per-widget localStorage key (예: 'widget-desk').
  id: string;
  // 말풍선이 가리키는 anchor (설정/업로드 버튼).
  children: ReactNode;
  // 안내 문구.
  message: string;
  // × aria-label (i18n). default 한국어.
  dismissLabel?: string;
};

export function OnboardingTooltip({
  id,
  children,
  message,
  dismissLabel = '닫기',
}: OnboardingTooltipProps) {
  // 영속 dismiss (localStorage). 서버/첫 렌더 스냅샷 = true(숨김).
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(dismissKey(id)) === '1';
    } catch {
      // localStorage 접근 불가(private mode 등) — 안내는 조용히 생략.
      return true;
    }
  }, [id]);
  const persistedDismissed = useSyncExternalStore(subscribe, getSnapshot, () => true);
  // 이번 세션에서 × / anchor 클릭으로 방금 닫은 경우.
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const dismissed = persistedDismissed || sessionDismissed;

  function dismiss() {
    setSessionDismissed(true);
    try {
      localStorage.setItem(dismissKey(id), '1');
    } catch {
      // 저장 실패해도 이번 세션 동안은 숨김 유지.
    }
  }

  if (dismissed) return <>{children}</>;

  return (
    <div className="relative inline-flex">
      {/* anchor 클릭 = "설정을 열었다" 로 간주 → dismiss. 버튼 자체 onClick 은
          그대로 전파되므로 설정 모달 오픈 + dismiss 가 함께 일어난다. */}
      <div onClickCapture={dismiss}>{children}</div>
      <div
        role="note"
        className="absolute left-0 top-full z-fab mt-2 flex items-center gap-2 rounded-sm border-[2px] border-ink bg-amore-bg px-3 py-2 shadow-memphis-md"
      >
        <span className="whitespace-nowrap text-sm text-ink-2">{message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={dismissLabel}
          className="shrink-0 leading-none text-mute transition-colors hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
