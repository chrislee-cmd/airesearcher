'use client';

/* ────────────────────────────────────────────────────────────────────
   usePaletteDrag — 팔레트 → 레인 조립 드래그 (P2a~P2f).

   CD SSOT: `canvas-modular/full/README.md` §5 (드래그) + 장면 P2a~P2f.
   필독 선례: `widget-chain/CHAIN-UI-LEARNINGS.md` §2-2(기하 판정) ·
   §8-2(portal 과 합성 이벤트) · §8-8(실포인터 하네스).

   ── 설계의 중심: 판정이 기하 하나다 ───────────────────────────────────────
   `mouseenter/leave` 도, `dragenter/leave` 도, HTML5 dnd 도 쓰지 않는다.
   팔레트(캔버스 transform **밖**, 화면 좌표)와 슬롯(transform **안**)이 서로
   다른 좌표계에 있지만 `getBoundingClientRect()` 가 이미 화면 좌표라 환산이
   필요 없다 — 포인터 clientX/Y 가 슬롯 rect 안인가, 그 질문 하나로 끝난다
   (§5 판정). 이벤트 포함-관계로 판정하면 §2-2 의 flicker 가 그대로 재발한다.

   그래서 리스너는 **document 레벨 pointermove/pointerup** 이다. 고스트는
   `pointer-events: none` 이고 레인 슬롯 위에 이미 portal 된 카드가 있어도
   상관없다 — 합성 이벤트 버블 경로를 아예 타지 않는다(§8-2).

   ── 저줌 ─────────────────────────────────────────────────────────────────
   FOCUS_THRESHOLD 미만에서는 카드마다 click-to-focus 오버레이가 깔린다.
   기하 판정이라 **드롭 판정 자체는 성립**하지만, 오버레이의 pointerup 이
   "그 위젯으로 줌인" 을 발화시켜 드롭 순간 화면이 튄다. 그래서 드래그 중에만
   오버레이에 `pointer-events: none` 을 준다 — 보드가 컨테이너에
   `data-palette-dragging` 을 달고 globals.css 가 그걸 받는다(§2-1 · §8-8).

   ── 낙관적 반영 ─────────────────────────────────────────────────────────
   드롭은 화면을 먼저 바꾸고(`dock`), 서버 거절은 레인 provider 가 이미 쓰는
   경로(409 → 상태 재조회)로 흘러간다. 확인 모달·카운트다운은 만들지 않는다
   (스펙 제약 6).
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DockPosition, DockVerdict } from '@/lib/chains/view';

/** 드래그로 확정되는 이동 거리 (§5 시작 — 그 전에 떼면 누르기). */
const DRAG_THRESHOLD = 4;
/** 취소 복귀 (§5 취소 — 원본 위치로 200ms ease-in-out). */
export const RETURN_MS = 200;
/** 빈 작업면 취소 안내 노출 시간 (§5 취소). */
export const EMPTY_HINT_MS = 1600;

/** 파일럿 호환 그래프는 일직선이라 받을 수 있는 자리는 앞/끝 둘이다. */
const KEYBOARD_POSITIONS: DockPosition[] = ['prepend', 'append'];

export type PaletteDragCancelReason =
  /** Esc */
  | 'esc'
  /** 슬롯 밖(빈 작업면 포함)에 놓음 — 이때만 안내 라벨을 띄운다. */
  | 'outside'
  /** 거절 슬롯에 놓음 */
  | 'reject'
  /** 팔레트 위에 놓음 */
  | 'palette';

export type PaletteDragState = {
  widgetKey: string;
  feature: string;
  mode: 'pointer' | 'keyboard';
  /** 고스트 좌상단 (화면 좌표). 키보드 모드는 고스트를 그리지 않아 null. */
  ghost: { x: number; y: number } | null;
  /** 지금 판정 중인 자리. null = 슬롯 밖. */
  over: DockPosition | null;
  verdict: DockVerdict | null;
  /** 취소 복귀 애니메이션 중 — 고스트가 원본 자리로 돌아가는 구간. */
  returning: boolean;
};

type Pending = {
  widgetKey: string;
  feature: string;
  pointerId: number;
  startX: number;
  startY: number;
  /** 집은 지점의 타일 내 오프셋 — 고스트가 그 관계를 유지한다(§5 고스트). */
  grabDx: number;
  grabDy: number;
  /** 원본 타일 좌상단 (화면 좌표) — 취소 복귀 목표점. */
  originX: number;
  originY: number;
};

export type PaletteDragApi = {
  drag: PaletteDragState | null;
  /**
   * 이 위젯이 지금 레인의 빈 자리에 들어갈 수 있는가 — §4.2 `fit` 상태의
   * 조건("레인에 빈 슬롯이 있고 가드를 통과"). 판정 소유자는 `validateSteps`
   * 하나다(`evaluate` 경유) — 프론트가 규칙을 복제하지 않는다.
   */
  canFit: (feature: string) => boolean;
  /** pointerdown ~ 4px 이동 전인 타일 (§4.2 press). */
  pressedKey: string | null;
  /** 빈 작업면 취소 안내를 띄울 좌표 (§5 취소). null 이면 미표시. */
  emptyHint: { x: number; y: number } | null;
  /** 타일에 붙이는 pointerdown 핸들러. */
  onTilePointerDown: (
    widgetKey: string,
    feature: string,
    canDrag: boolean,
  ) => (e: ReactPointerEvent<HTMLElement>) => void;
  /** 직전 pointerdown 이 드래그로 번졌는가 — 클릭 억제 판정용. */
  consumeDragClick: () => boolean;
  /** 키보드 들어올림 (Space). */
  lift: (widgetKey: string, feature: string) => void;
  /** 들어올린 상태에서 자리 이동 (←→). */
  moveLift: (delta: 1 | -1) => void;
  /** 들어올린 것을 놓는다 (Space/Enter). 성공하면 true. */
  commitLift: () => boolean;
  /** 들어올림 취소 (Esc). */
  cancelLift: () => void;
};

export function usePaletteDrag({
  laneActive,
  evaluate,
  dock,
  onDropped,
  onPanToLane,
  isPaletteRect,
}: {
  /** 레인이 있고 구성을 바꿀 수 있는가. false 면 드래그가 시작되지 않는다. */
  laneActive: boolean;
  evaluate: (feature: string, position: DockPosition) => DockVerdict;
  dock: (feature: string, position: DockPosition) => void;
  /** 드롭 성공 직후 — 포커스 이동 등 호출부의 후처리. */
  onDropped: (widgetKey: string, position: DockPosition) => void;
  /** 키보드 이동 시 레인이 화면 밖이면 레인으로 팬 (§5 키보드). */
  onPanToLane: () => void;
  /** 좌표가 팔레트 위인가 — 취소 사유 구분(§5 취소). */
  isPaletteRect: (x: number, y: number) => boolean;
}): PaletteDragApi {
  const [drag, setDrag] = useState<PaletteDragState | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const pendingRef = useRef<Pending | null>(null);
  const activeRef = useRef<Pending | null>(null);
  const pointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const draggedClickRef = useRef(false);
  const returnTimerRef = useRef(0);
  const hintTimerRef = useRef(0);

  const reducedMotion = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = mq.matches;
    const sync = () => {
      reducedMotion.current = mq.matches;
    };
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /** 포인터 좌표가 들어 있는 **빈 슬롯** — 판정의 전부 (§5 판정). */
  const slotAt = useCallback((x: number, y: number): DockPosition | null => {
    const els = document.querySelectorAll<HTMLElement>('[data-chain-slot]');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        // 레인이 렌더하는 빈 슬롯은 "다음 자리" 하나다(v3 구조 — 이 PR 은
        // 레인 내부를 바꾸지 않는다). 앞자리(prepend)는 키보드로 닿는다.
        return 'append';
      }
    }
    return null;
  }, []);

  const clearTimers = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (returnTimerRef.current) {
      window.clearTimeout(returnTimerRef.current);
      returnTimerRef.current = 0;
    }
  }, []);

  /** 취소 — 고스트를 원본 자리로 되돌린 뒤 사라진다 (§5 취소). */
  const cancelDrag = useCallback(
    (reason: PaletteDragCancelReason, at: { x: number; y: number } | null) => {
      const active = activeRef.current;
      activeRef.current = null;
      pendingRef.current = null;
      setPressedKey(null);
      if (!active) {
        setDrag(null);
        return;
      }
      // 빈 작업면에 놓아 취소된 경우에만 안내를 1.6s (§5 취소 — 안내).
      if (reason === 'outside' && at) {
        setEmptyHint(at);
        if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
        hintTimerRef.current = window.setTimeout(
          () => setEmptyHint(null),
          EMPTY_HINT_MS,
        );
      }
      if (reducedMotion.current) {
        setDrag(null);
        return;
      }
      // 복귀 보간은 **레이어를 건너지 않는다** — 고스트도 원본도 화면 좌표다.
      setDrag({
        widgetKey: active.widgetKey,
        feature: active.feature,
        mode: 'pointer',
        ghost: { x: active.originX, y: active.originY },
        over: null,
        verdict: null,
        returning: true,
      });
      returnTimerRef.current = window.setTimeout(() => {
        setDrag(null);
        returnTimerRef.current = 0;
      }, RETURN_MS);
    },
    [],
  );

  /** 드롭 — 고스트를 **즉시** 제거하고 낙관적으로 반영 (§5 드롭). */
  const commitDrop = useCallback(
    (position: DockPosition) => {
      const active = activeRef.current;
      activeRef.current = null;
      pendingRef.current = null;
      setPressedKey(null);
      setDrag(null);
      if (!active) return;
      dock(active.feature, position);
      onDropped(active.widgetKey, position);
    },
    [dock, onDropped],
  );

  // ── 포인터 루프 — pending(임계 전) 또는 active(드래그 중)일 때만 청취 ──
  const listening = pressedKey !== null || (drag !== null && !drag.returning);
  useEffect(() => {
    if (!listening) return;

    const flush = () => {
      rafRef.current = 0;
      const { x, y } = pointRef.current;
      const pending = pendingRef.current;
      // 임계 전 — 4px 를 넘기면 드래그로 확정한다.
      if (pending && !activeRef.current) {
        const moved = Math.hypot(x - pending.startX, y - pending.startY);
        if (moved < DRAG_THRESHOLD) return;
        activeRef.current = pending;
        draggedClickRef.current = true;
        setPressedKey(null);
      }
      const active = activeRef.current;
      if (!active) return;
      const over = slotAt(x, y);
      const verdict = over ? evaluate(active.feature, over) : null;
      setDrag({
        widgetKey: active.widgetKey,
        feature: active.feature,
        mode: 'pointer',
        ghost: { x: x - active.grabDx, y: y - active.grabDy },
        over,
        verdict,
        returning: false,
      });
    };

    const onMove = (e: PointerEvent) => {
      pointRef.current = { x: e.clientX, y: e.clientY };
      // rAF 스로틀 — 레이아웃 읽기(rect)를 프레임당 1회로 묶는다(§2-2 주석).
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(flush);
    };

    const onUp = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const active = activeRef.current;
      if (!active) {
        // 임계를 넘지 않았다 = 누르기. 타일 버튼의 click 이 그대로 처리한다.
        pendingRef.current = null;
        setPressedKey(null);
        return;
      }
      const over = slotAt(x, y);
      if (!over) {
        cancelDrag(isPaletteRect(x, y) ? 'palette' : 'outside', { x, y });
        return;
      }
      const verdict = evaluate(active.feature, over);
      if (!verdict.ok) {
        cancelDrag('reject', null);
        return;
      }
      commitDrop(over);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!activeRef.current) return;
      e.preventDefault();
      cancelDrag('esc', null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [listening, slotAt, evaluate, cancelDrag, commitDrop, isPaletteRect]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onTilePointerDown = useCallback(
    (widgetKey: string, feature: string, canDrag: boolean) =>
      (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        // 새 제스처가 시작됐다 — 직전 제스처의 "드래그였음" 표시를 비운다.
        // 비우지 않으면 **드롭 성공 직후의 다음 누르기가 통째로 삼켜진다**:
        // `commitDrop` 은 성공 경로라 플래그를 소비하는 click 이 따라오지 않고,
        // 그 다음 타일 click 이 "이건 드래그였다" 로 오인된다(프리뷰 오라클
        // 실측: 드롭 후 chain 타일을 눌러도 P1b 팬·링이 안 돌았다).
        draggedClickRef.current = false;
        // press 피드백은 **항상** 준다 — 누르는 중이라는 사실은 끌 수 있는지와
        // 무관하다(§4.2 press). 아래 pending 무장만 조건부다.
        setPressedKey(widgetKey);
        // 체인 소속 타일은 끌 수 없고(§4.2 chain), 레인이 없거나 잠겼으면 끌
        // 데가 없다 — 둘 다 누르기만 남는다.
        if (!canDrag || !laneActive) return;
        const rect = e.currentTarget.getBoundingClientRect();
        pendingRef.current = {
          widgetKey,
          feature,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          grabDx: e.clientX - rect.left,
          grabDy: e.clientY - rect.top,
          originX: rect.left,
          originY: rect.top,
        };
        pointRef.current = { x: e.clientX, y: e.clientY };
      },
    [laneActive],
  );

  const canFit = useCallback(
    (feature: string) => {
      if (!laneActive) return false;
      return (
        evaluate(feature, 'append').ok || evaluate(feature, 'prepend').ok
      );
    },
    [laneActive, evaluate],
  );

  const consumeDragClick = useCallback(() => {
    const was = draggedClickRef.current;
    draggedClickRef.current = false;
    return was;
  }, []);

  // ── 키보드 드래그 (§5 키보드 · P2f) ─────────────────────────────────
  // 고스트를 그리지 않는다 — 대상 슬롯이 accept 로 바뀌는 것으로 위치를
  // 보여준다. 거절 자리도 **건너뛰지 않고** 들러서 사유를 읽어 준다.
  const lift = useCallback(
    (widgetKey: string, feature: string) => {
      if (!laneActive) return;
      const position: DockPosition = 'append';
      setDrag({
        widgetKey,
        feature,
        mode: 'keyboard',
        ghost: null,
        over: position,
        verdict: evaluate(feature, position),
        returning: false,
      });
    },
    [laneActive, evaluate],
  );

  const moveLift = useCallback(
    (delta: 1 | -1) => {
      setDrag((curr) => {
        if (!curr || curr.mode !== 'keyboard') return curr;
        const i = KEYBOARD_POSITIONS.indexOf(curr.over ?? 'append');
        const next =
          KEYBOARD_POSITIONS[
            (i + delta + KEYBOARD_POSITIONS.length) % KEYBOARD_POSITIONS.length
          ];
        return { ...curr, over: next, verdict: evaluate(curr.feature, next) };
      });
      onPanToLane();
    },
    [evaluate, onPanToLane],
  );

  const commitLift = useCallback((): boolean => {
    const curr = drag;
    if (!curr || curr.mode !== 'keyboard' || !curr.over) return false;
    if (!curr.verdict?.ok) return false;
    setDrag(null);
    dock(curr.feature, curr.over);
    onDropped(curr.widgetKey, curr.over);
    return true;
  }, [drag, dock, onDropped]);

  const cancelLift = useCallback(() => {
    setDrag((curr) => (curr?.mode === 'keyboard' ? null : curr));
  }, []);

  return useMemo(
    () => ({
      drag,
      canFit,
      pressedKey,
      emptyHint,
      onTilePointerDown,
      consumeDragClick,
      lift,
      moveLift,
      commitLift,
      cancelLift,
    }),
    [
      drag,
      canFit,
      pressedKey,
      emptyHint,
      onTilePointerDown,
      consumeDragClick,
      lift,
      moveLift,
      commitLift,
      cancelLift,
    ],
  );
}
