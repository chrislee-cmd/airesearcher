'use client';

// Voice Concierge — first-time onboarding flag.
//
// PR4 Bundle 1: the FAB pulses + shows a "처음이세요?" tooltip the very
// first time a logged-in PREVIEW-eligible user lands on any (app) route.
// We persist a single localStorage key so the cue dismisses for good after
// the first interaction (FAB click OR explicit opt-out from the tooltip).
//
// SSR-safe: returns `false` until the component mounts, so the FAB never
// renders a pulse on the server only to have it disappear on hydration.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'voice_concierge_intro_seen';

export type UseFirstTimeFlag = {
  isFirstTime: boolean;
  markSeen: () => void;
};

export function useFirstTimeFlag(): UseFirstTimeFlag {
  const [isFirstTime, setIsFirstTime] = useState(false);

  // Read once on mount. Privacy-mode browsers throw on localStorage access
  // — we treat that as "seen" so we never spam a user who actively blocks
  // storage with an undismissable hint.
  //
  // The set-state-in-effect lint rule trips here, but the rule's
  // recommendation (compute initial state synchronously) doesn't apply
  // because (a) we render under SSR where window doesn't exist, and (b)
  // useSyncExternalStore on localStorage would require a noop subscribe
  // for a value we read once and never need to track changes for. The
  // cascading-render concern is also a non-issue: this state flips at
  // most once per mount and gates a tiny CSS class, not a render-tree
  // branch.
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsFirstTime(seen !== 'seen');
    } catch {
      setIsFirstTime(false);
    }
  }, []);

  const markSeen = useCallback(() => {
    setIsFirstTime(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'seen');
    } catch {
      /* privacy-mode — state still flips to false for this session */
    }
  }, []);

  return { isFirstTime, markSeen };
}
