'use client';

/* ────────────────────────────────────────────────────────────────────
   useHiddenDefaults — 프로빙 기본 8 페르소나 위젯의 개별 숨김 관리.

   PR (probing-default-persona-widgets-hide): 사용자 결정 — "기본 8개를 다
   원하지 않는 사람도 있다". custom 섹션과 동일한 × 삭제 UX 를 기본 8
   (demographics/values/…/behavioral_patterns) 에도 부여한다.

   중요 — 이것은 **UI-only hide** 다. backend (catchall schema) 는 여전히
   기본 8 을 required 로 항상 채우므로 (LLM 응답 안전 보장), 이 hook 은
   렌더 필터만 담당. 데이터는 응답에 그대로 존재해 restore 시 즉시 재렌더.

   영속화: localStorage (세션 단위, 기기별). custom 섹션의
   use-custom-sections 와 동일한 hydrate-in-effect 패턴을 따른다 — 초기
   서버/클라 렌더는 빈 Set 으로 통일해 hydration mismatch 를 피하고, mount
   이후 1회 hydrate 로 저장된 숨김 목록을 반영.

   custom 섹션의 삭제(useCustomSections.remove)는 정의 자체를 영구 제거
   하지만, 여기 hide 는 데이터 보존 + 필터일 뿐이라 restore 로 되돌릴 수
   있다 — 그래서 별도 storage key 로 분리한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'probing:hidden-defaults:v1';

function loadFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

export type UseHiddenDefaults = {
  hiddenKeys: Set<string>;
  hydrated: boolean;
  hide: (key: string) => void;
  restore: (key: string) => void;
  restoreAll: () => void;
};

export function useHiddenDefaults(): UseHiddenDefaults {
  // hidden + hydrated 를 단일 state 로 — use-custom-sections 와 동일하게
  // mount hydrate 를 setState 1회로 처리. hydrated 이전엔 저장 skip 해
  // 초기 빈 Set 이 localStorage 를 덮지 않도록.
  const [state, setState] = useState<{ hidden: Set<string>; hydrated: boolean }>(
    { hidden: new Set(), hydrated: false },
  );

  // mount 시 1회 — localStorage hydrate. SSR 안전 ('use client').
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage on mount
    setState({ hidden: loadFromStorage(), hydrated: true });
  }, []);

  // 변경 시 저장 (hydrate 이후에만).
  const hydratedRef = useRef(state.hydrated);
  useEffect(() => {
    hydratedRef.current = state.hydrated;
  }, [state.hydrated]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.hidden]));
    } catch {
      // best-effort — quota 초과 등은 조용히 무시.
    }
  }, [state.hidden]);

  const hide = useCallback((key: string) => {
    setState((prev) => {
      if (prev.hidden.has(key)) return prev;
      const next = new Set(prev.hidden);
      next.add(key);
      return { ...prev, hidden: next };
    });
  }, []);

  const restore = useCallback((key: string) => {
    setState((prev) => {
      if (!prev.hidden.has(key)) return prev;
      const next = new Set(prev.hidden);
      next.delete(key);
      return { ...prev, hidden: next };
    });
  }, []);

  const restoreAll = useCallback(() => {
    setState((prev) =>
      prev.hidden.size === 0 ? prev : { ...prev, hidden: new Set() },
    );
  }, []);

  return {
    hiddenKeys: state.hidden,
    hydrated: state.hydrated,
    hide,
    restore,
    restoreAll,
  };
}
