'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetStateContext — 위젯 shell ↔ body 양방향 상태 채널.

   widget-shell 의 PopStatePill 은 헤더 (shell) 에 있고, job hook 은
   ExpandedBody (body) 안에서만 살아 있다. 둘 사이를 잇는 1-위젯-1-인스턴스
   context — shell 이 Provider 로 wrap 하면 body 가 useWidgetState() 로
   현재 상태를 push (`setState`) 하고, 헤더 pill 이 같은 hook 으로 읽는다.

   추가로, parent-level `WidgetStatesMapProvider` 가 있으면 각 위젯의
   Provider 가 자기 키로 그 map 에 sync — Navigator 처럼 위젯 밖에서
   "모든 위젯 상태" 를 읽고 싶을 때 `useWidgetStateOf(key)` 로 접근한다.
   Map 없는 환경 (canvas 밖 단독 마운트) 에서도 안전 (no-op).

   초기값은 widget meta 의 정적 `content.state` (현재 모든 위젯이 'idle')
   를 사용. body 가 아무 setState 도 호출 안 하는 frontend-only 위젯은
   초기값 그대로 'READY' 표시 유지.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

// ── parent-level map: 모든 위젯 상태를 한 곳에서 구독 (Navigator 용) ──
type WidgetStatesMap = Record<string, WidgetStateInfo>;
type WidgetStatesMapApi = {
  states: WidgetStatesMap;
  setWidgetState: (key: string, next: WidgetStateInfo) => void;
};

const WidgetStatesMapContext = createContext<WidgetStatesMapApi | null>(null);

function statesShallowEqual(a: WidgetStateInfo, b: WidgetStateInfo): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'running' && b.kind === 'running') {
    return (
      a.progress === b.progress &&
      a.label === b.label &&
      a.overallProgress === b.overallProgress
    );
  }
  if (a.kind === 'error' && b.kind === 'error') {
    return a.message === b.message;
  }
  return true;
}

export function WidgetStatesMapProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<WidgetStatesMap>({});
  const setWidgetState = useCallback((key: string, next: WidgetStateInfo) => {
    setStates((prev) => {
      const curr = prev[key];
      if (curr && statesShallowEqual(curr, next)) return prev;
      return { ...prev, [key]: next };
    });
  }, []);
  const value = useMemo(
    () => ({ states, setWidgetState }),
    [states, setWidgetState],
  );
  return (
    <WidgetStatesMapContext.Provider value={value}>
      {children}
    </WidgetStatesMapContext.Provider>
  );
}

export function useWidgetStateOf(key: string): WidgetStateInfo {
  const map = useContext(WidgetStatesMapContext);
  if (!map) return { kind: 'idle' };
  return map.states[key] ?? { kind: 'idle' };
}

export function WidgetStateProvider({
  widgetKey,
  initialState,
  children,
}: {
  // 옵션: parent map 에 sync 할 식별자. canvas 안 위젯은 항상 전달.
  // 미전달 시 map 동기화 생략 (단독 마운트 환경 호환).
  widgetKey?: string;
  initialState: WidgetStateInfo;
  children: ReactNode;
}) {
  const [state, setStateRaw] = useState<WidgetStateInfo>(initialState);
  const map = useContext(WidgetStatesMapContext);
  // Latest map via ref — keeps setState identity stable across global map
  // updates so per-widget consumers (PopStatePill) don't re-render whenever
  // any other widget pushes state.
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  // mount 시 parent map 에 초기 상태 등록. widgetKey 만 dep — initialState
  // 객체는 매 렌더 새로 생성될 수 있으나 widget meta 의 정적값이라 의미는
  // 동일. map 변경에 따라 재등록 안 함 (한 mount = 한 등록).
  useEffect(() => {
    if (!widgetKey) return;
    const m = mapRef.current;
    if (!m) return;
    m.setWidgetState(widgetKey, initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only register
  }, [widgetKey]);

  const setState = useCallback(
    (next: WidgetStateInfo) => {
      setStateRaw(next);
      const m = mapRef.current;
      if (widgetKey && m) m.setWidgetState(widgetKey, next);
    },
    [widgetKey],
  );

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
