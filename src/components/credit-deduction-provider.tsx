'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FeatureKey } from '@/lib/features';

// Lightweight client-side broadcast for "방금 N 크레딧 차감됐다" 신호.
// 백엔드 `spend_credits` 의 응답 형식 통일은 별 spec — 이 PR 에서는
// 클라이언트 시각 인터랙션만 wire 한다. 호출처는 두 가지:
//
//   1) GenerationJobProvider.start() 가 성공으로 resolve 될 때 자동
//      notify (feature placeholder 류 — recruiting / reports / 일반
//      generator). FEATURE_COSTS[feature] 를 amount 로 사용.
//   2) Canvas widget 이 자기 API 호출 후 직접 notify (probing / desk /
//      transcripts 같이 dynamic 차감) — 후속 PR.
//
// Subscriber 는 매 emit 마다 tick 가 증가하는 lastEvent 를 보고 useEffect
// 로 반응. balance 가 같이 오면 topbar 가 그 값으로 count-down 시작.

export type CreditDeductionEvent = {
  feature: FeatureKey;
  amount: number;
  balance?: number;
  /** Monotonic counter — subscribers depend on this so identical
   *  (feature, amount) emits still re-fire the effect. */
  tick: number;
};

type Ctx = {
  lastEvent: CreditDeductionEvent | null;
  notify: (feature: FeatureKey, amount: number, balance?: number) => void;
};

const CreditDeductionCtx = createContext<Ctx | null>(null);

export function CreditDeductionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [lastEvent, setLastEvent] = useState<CreditDeductionEvent | null>(null);
  const tickRef = useRef(0);

  const notify = useCallback<Ctx['notify']>((feature, amount, balance) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    tickRef.current += 1;
    setLastEvent({ feature, amount, balance, tick: tickRef.current });
  }, []);

  const value = useMemo<Ctx>(() => ({ lastEvent, notify }), [lastEvent, notify]);

  return (
    <CreditDeductionCtx.Provider value={value}>
      {children}
    </CreditDeductionCtx.Provider>
  );
}

/** Always returns a value — falls back to a no-op so non-app routes
 *  (e.g. /sign-in) that render shared UI without the provider don't crash. */
export function useCreditDeduction(): Ctx {
  const ctx = useContext(CreditDeductionCtx);
  if (ctx) return ctx;
  return { lastEvent: null, notify: () => {} };
}

/** Hook: run `handler` on each new deduction event, optionally filtered by
 *  feature key. Returns nothing — purely side-effect. */
export function useCreditDeductionEvent(
  handler: (event: CreditDeductionEvent) => void,
  filter?: FeatureKey,
) {
  const { lastEvent } = useCreditDeduction();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!lastEvent) return;
    if (filter && lastEvent.feature !== filter) return;
    handlerRef.current(lastEvent);
  }, [lastEvent, filter]);
}
