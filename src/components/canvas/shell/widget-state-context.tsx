'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetStateContext — 위젯 shell ↔ body 양방향 상태 채널.

   widget-shell 의 PopStatePill 은 헤더 (shell) 에 있고, job hook 은
   ExpandedBody (body) 안에서만 살아 있다. 둘 사이를 잇는 1-위젯-1-인스턴스
   context — shell 이 Provider 로 wrap 하면 body 가 useWidgetState() 로
   현재 상태를 push (`setState`) 하고, 헤더 pill 이 같은 hook 으로 읽는다.

   초기값은 widget meta 의 정적 `content.state` (현재 모든 위젯이 'idle')
   를 사용. body 가 아무 setState 도 호출 안 하는 frontend-only 위젯은
   초기값 그대로 'READY' 표시 유지.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { WidgetStateInfo } from '../widget-types';

type WidgetStateApi = {
  state: WidgetStateInfo;
  setState: (next: WidgetStateInfo) => void;
};

const NOOP_API: WidgetStateApi = {
  state: { kind: 'idle' },
  setState: () => {},
};

const WidgetStateContext = createContext<WidgetStateApi | null>(null);

export function WidgetStateProvider({
  initialState,
  children,
}: {
  initialState: WidgetStateInfo;
  children: ReactNode;
}) {
  const [state, setStateRaw] = useState<WidgetStateInfo>(initialState);
  const setState = useCallback((next: WidgetStateInfo) => {
    setStateRaw(next);
  }, []);
  const value = useMemo(() => ({ state, setState }), [state, setState]);
  return (
    <WidgetStateContext.Provider value={value}>
      {children}
    </WidgetStateContext.Provider>
  );
}

// Provider 가 없는 컨텍스트 (예: 위젯이 canvas 밖 page 에 단독으로 마운트)
// 에서도 안전하게 호출 가능 — setState 는 no-op, state 는 'idle'.
export function useWidgetState(): WidgetStateApi {
  return useContext(WidgetStateContext) ?? NOOP_API;
}
