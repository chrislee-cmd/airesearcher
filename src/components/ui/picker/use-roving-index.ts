'use client';

/* ────────────────────────────────────────────────────────────────────
   useRovingIndex — listbox 옵션의 키보드 네비게이션(G6) 공통 로직.

   패널 옵션 목록에 roving tabindex 를 부여한다. 활성 인덱스 1개만 tabIndex=0,
   나머지는 -1. `↑↓`(+ Home/End) 로 활성 인덱스를 이동하며 해당 옵션에 포커스.
   Space/Enter/좌우 pane 이동 같은 의미 키는 소비 패널이 각자 처리(모델별로
   동작이 다르므로) — 이 훅은 "어느 옵션이 활성인가 + 상하 이동"만 소유한다.

   접근성: 옵션 컨테이너에 role="listbox"(+ P2/P3 aria-multiselectable), 각
   옵션에 role="option"[aria-selected] 를 붙이고, getItemProps(i) 로 tabIndex/
   ref/포커스 핸들러를 배선한다. open 시 selectedIndex(없으면 0)로 초기 포커스.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

export type UseRovingIndexResult = {
  /** 현재 활성(포커스 대상) 인덱스. */
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  /** 옵션 컨테이너 onKeyDown 에 붙임 — ↑↓ Home/End 처리. */
  onKeyDown: (e: ReactKeyboardEvent) => void;
  /** 각 옵션 요소에 spread — ref + tabIndex. */
  getItemProps: (i: number) => {
    ref: (el: HTMLElement | null) => void;
    tabIndex: number;
  };
  /** 활성 인덱스로 실제 DOM 포커스 이동(pane 진입 시 등). */
  focusActive: () => void;
};

export function useRovingIndex({
  count,
  active,
  initialIndex = 0,
  autoFocus = false,
}: {
  count: number;
  /** 훅이 살아있어야(포커스 관리) 하는지 — 닫힌 pane 은 false. */
  active: boolean;
  initialIndex?: number;
  /** active 로 전환될 때 활성 옵션에 자동 포커스(패널 open 진입). */
  autoFocus?: boolean;
}): UseRovingIndexResult {
  const [rawIndex, setActiveIndexState] = useState(initialIndex);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);

  // count 축소 시 렌더 시점에 클램프(effect-setState 없이). rawIndex 는 그대로
  // 두되 노출/포커스 대상은 항상 clamp.
  const activeIndex = count > 0 ? Math.min(rawIndex, count - 1) : 0;

  const focusIndex = useCallback((i: number) => {
    const el = itemsRef.current[i];
    if (el) el.focus();
  }, []);

  const setActiveIndex = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(i, count - 1));
      setActiveIndexState(clamped);
      focusIndex(clamped);
    },
    [count, focusIndex],
  );

  const focusActive = useCallback(() => {
    focusIndex(Math.max(0, Math.min(activeIndex, count - 1)));
  }, [activeIndex, count, focusIndex]);

  // active 상승 엣지에서만 초기 포커스(패널 open · pane 진입). count 변화(검색
  // 필터링 등)로는 재포커스하지 않는다 — 검색 입력 중 포커스 도난 방지.
  const prevActive = useRef(false);
  useEffect(() => {
    const rising = active && !prevActive.current;
    prevActive.current = active;
    // count/initialIndex 는 상승 엣지 시점의 클로저 값을 스냅샷으로 사용(딥스에
    // 넣지 않음 — count 변화로 재포커스하면 검색 입력 중 포커스 도난).
    if (rising && autoFocus && count > 0) {
      const i = Math.max(0, Math.min(initialIndex, count - 1));
      setActiveIndexState(i);
      const raf = requestAnimationFrame(() => focusIndex(i));
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoFocus]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (count === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((activeIndex + 1) % count);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((activeIndex - 1 + count) % count);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(count - 1);
          break;
        default:
          break;
      }
    },
    [activeIndex, count, setActiveIndex],
  );

  const getItemProps = useCallback(
    (i: number) => ({
      ref: (el: HTMLElement | null) => {
        itemsRef.current[i] = el;
      },
      tabIndex: i === activeIndex ? 0 : -1,
    }),
    [activeIndex],
  );

  return { activeIndex, setActiveIndex, onKeyDown, getItemProps, focusActive };
}
