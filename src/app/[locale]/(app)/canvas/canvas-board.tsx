'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. 대시보드 + pan + zoom-out + 자유 reposition.

   - 모든 위젯 항상 펼친 상태 (collapse 없음).
   - 너비 위젯별 (meta.expandedCols 1/2/3 → 240 / 528 / 816 px).
   - height 통일 800 — 본문 길면 widget-shell 의 overflow-y-auto.
   - 6×5 그리드 절대 좌표 (CELL_W 240, CELL_H 800, GAP 48). 각 위젯이
     (col, row) anchor 를 가지고 expandedCols 만큼 col 방향으로 span.
   - 빈 cell 들도 drop target — 위젯을 빈 영역으로 자유 이동 가능.
     다른 위젯과 겹치는 곳에 drop = 두 위젯 swap.
   - 빈 영역 drag = pan, 휠 = zoom-out (1.0 ~ 0.4, cursor focal point).
   - 위젯 header 영역 drag = 순서/위치 변경. localStorage 영속.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import type { WidgetContent } from '@/components/canvas/widget-types';

const CELL_W = 240;
const CELL_H = 800;
const GAP = 48;
const GRID_COLS = 6;
const GRID_ROWS = 5;
const SURFACE_W = GRID_COLS * CELL_W + (GRID_COLS - 1) * GAP;
const SURFACE_H = GRID_ROWS * CELL_H + (GRID_ROWS - 1) * GAP;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.0;
const ZOOM_FACTOR = 1.05;
const POSITIONS_STORAGE_KEY = 'canvas:dashboard-positions:v1';
const TRANSPARENT_GHOST_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type Coords = { col: number; row: number };

function expandedWidthOf(cols: number): number {
  return cols * CELL_W + (cols - 1) * GAP;
}

function spanOf(w: WidgetContent | undefined): number {
  return w?.meta.expandedCols ?? 2;
}

// 좌측 상단부터 row-major 로 위젯을 채움 — 각 위젯의 span 만큼 col 진행,
// 다음 위젯이 row 끝 초과하면 새 row 로.
function defaultPositions(widgets: WidgetContent[]): Record<string, Coords> {
  const out: Record<string, Coords> = {};
  let col = 0;
  let row = 0;
  for (const w of widgets) {
    const span = spanOf(w);
    if (col + span > GRID_COLS) {
      col = 0;
      row += 1;
    }
    out[w.key] = { col, row };
    col += span;
  }
  return out;
}

export function CanvasBoard({
  widgets,
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
}) {
  const [positions, setPositions] = useState<Record<string, Coords>>(() =>
    defaultPositions(widgets),
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, Coords>;
      if (typeof stored !== 'object' || stored === null) return;
      const valid = new Set(widgets.map((w) => w.key));
      const merged: Record<string, Coords> = {};
      const occupied = new Set<string>();
      // stored 좌표 채택 (valid widget + range 안에 있을 때만).
      widgets.forEach((w) => {
        const p = stored[w.key];
        if (
          p &&
          typeof p.col === 'number' &&
          typeof p.row === 'number' &&
          p.col >= 0 &&
          p.col + spanOf(w) <= GRID_COLS &&
          p.row >= 0 &&
          p.row < GRID_ROWS
        ) {
          merged[w.key] = { col: p.col, row: p.row };
          for (let i = 0; i < spanOf(w); i += 1) {
            occupied.add(`${p.col + i},${p.row}`);
          }
        }
      });
      // stored 에 없는 widget 은 빈 셀에 row-major 로 fallback.
      let cursorCol = 0;
      let cursorRow = 0;
      widgets.forEach((w) => {
        if (!valid.has(w.key)) return;
        if (merged[w.key]) return;
        const span = spanOf(w);
        // 첫 fit cell 찾기
        while (cursorRow < GRID_ROWS) {
          if (cursorCol + span > GRID_COLS) {
            cursorCol = 0;
            cursorRow += 1;
            continue;
          }
          let fits = true;
          for (let i = 0; i < span; i += 1) {
            if (occupied.has(`${cursorCol + i},${cursorRow}`)) {
              fits = false;
              break;
            }
          }
          if (fits) {
            merged[w.key] = { col: cursorCol, row: cursorRow };
            for (let i = 0; i < span; i += 1) {
              occupied.add(`${cursorCol + i},${cursorRow}`);
            }
            cursorCol += span;
            break;
          }
          cursorCol += 1;
        }
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage on mount
      setPositions(merged);
    } catch {
      /* localStorage 접근 실패 — default 유지 */
    }
  }, [widgets]);

  const persist = useCallback((next: Record<string, Coords>) => {
    try {
      window.localStorage.setItem(
        POSITIONS_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      /* quota / private mode */
    }
  }, []);

  const widgetByKey = useMemo(
    () => Object.fromEntries(widgets.map((w) => [w.key, w])),
    [widgets],
  );

  // 점유 셀 Set — 빈 셀 렌더 + 충돌 감지에 사용.
  const occupiedCells = useMemo(() => {
    const occ = new Map<string, string>(); // "c,r" → widget key
    Object.entries(positions).forEach(([k, p]) => {
      const span = spanOf(widgetByKey[k]);
      for (let i = 0; i < span; i += 1) {
        occ.set(`${p.col + i},${p.row}`, k);
      }
    });
    return occ;
  }, [positions, widgetByKey]);

  // pan / zoom
  // pan 좌표는 React state 가 아니라 ref 로 관리하고 transform 을 imperative
  // 하게 (surfaceRef.style.transform) 쓴다. 매 mousemove 마다 setState 하면
  // CanvasBoard 전체 트리 (6 위젯 × 본문 수백~수천 줄 + 30 grid cell) 가
  // 재 reconcile 되어 본문 떨림 / pan jank 가 발생한다 (PR #398 진단). zoom 만
  // wheel 이벤트로 드물게 변경되므로 React state 로 유지.
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  // 빈 영역 drag 가 즉시 pan 을 시작하면 텍스트 선택·셀 클릭 같은 자연스러운
  // 마우스 동작이 막힌다. 스페이스바를 누르고 있을 때만 pan 모드로 전환
  // (Figma·Miro 류 표준). 커서: 평소 default(arrow), space-held 시 grab,
  // drag 중엔 grabbing.
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panStartRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // surface 의 transform 을 직접 쓴다. React 의 inline style 에는 transform 을
  // 두지 않아 zoom state 변화에도 stale write 가 발생하지 않는다.
  const applyTransform = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const { x, y } = panRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoomRef.current})`;
  }, []);

  // 매 render 직후 transform 을 동기화 — 초기 마운트, zoom 변경, 그 외 React
  // 가 트리거한 모든 commit 후에 imperative write 한 번. paint 전이라 깜빡임 X.
  useLayoutEffect(() => {
    applyTransform();
  });

  // dnd
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.src = TRANSPARENT_GHOST_SRC;
    ghostRef.current = img;
  }, []);

  // 스페이스바 hold → pan 모드. input/textarea/contenteditable 안에서는 무시.
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setIsSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditableTarget(e.target)) return;
      setIsSpaceHeld(false);
    };
    const onBlur = () => setIsSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const currentZoom = zoomRef.current;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, currentZoom * factor),
      );
      if (nextZoom === currentZoom) return;
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ratio = nextZoom / currentZoom;
      // pan 도 ref — focal point 보정 후 곧 useLayoutEffect 가 transform 동기화.
      panRef.current = {
        x: cx * (1 - ratio) + panRef.current.x * ratio,
        y: cy * (1 - ratio) + panRef.current.y * ratio,
      };
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // 스페이스바를 누르고 있을 때만 pan 시작. 그 외엔 위젯/셀 클릭 등 자연스러운
      // 마우스 동작을 막지 않는다 (위젯 헤더 drag-reposition 은 widget-shell 이
      // 자체 stopPropagation 으로 처리).
      if (!isSpaceHeld) return;
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      setIsPanning(true);
    },
    [isSpaceHeld],
  );

  const onMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const start = panStartRef.current;
      if (!start) return;
      // ref 만 갱신. setState 하지 않으므로 React 트리 재 reconcile 없음.
      panRef.current = {
        x: start.panX + (e.clientX - start.startX),
        y: start.panY + (e.clientY - start.startY),
      };
      // RAF coalesce — 1000Hz 게이밍 마우스에서도 frame 당 1회만 paint 트리거.
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          applyTransform();
        });
      }
    },
    [applyTransform],
  );

  const onMouseUp = useCallback(() => {
    panStartRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // 마지막 mousemove 의 결과가 paint 되도록 한 번 더 commit.
      applyTransform();
    }
    setIsPanning(false);
  }, [applyTransform]);

  // ── dnd reposition ──────────────────────────────────────────────────
  const onHandleDragStart = useCallback(
    (key: string) => (e: ReactDragEvent<HTMLElement>) => {
      e.stopPropagation();
      if (ghostRef.current) {
        try {
          e.dataTransfer.setDragImage(ghostRef.current, 0, 0);
        } catch {
          /* Firefox 일부 */
        }
      }
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'move';
      setDragKey(key);
    },
    [],
  );

  const onCellDragOver = useCallback(
    (col: number, row: number) =>
      (e: ReactDragEvent<HTMLElement>) => {
        if (!dragKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const cell = `${col},${row}`;
        if (hoverCell !== cell) setHoverCell(cell);
      },
    [dragKey, hoverCell],
  );

  const onCellDragLeave = useCallback(
    (col: number, row: number) => () => {
      const cell = `${col},${row}`;
      if (hoverCell === cell) setHoverCell(null);
    },
    [hoverCell],
  );

  const onCellDrop = useCallback(
    (col: number, row: number) => (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault();
      const sourceKey = e.dataTransfer.getData('text/plain') || dragKey;
      setDragKey(null);
      setHoverCell(null);
      if (!sourceKey) return;
      const sourceWidget = widgetByKey[sourceKey];
      if (!sourceWidget) return;
      const span = spanOf(sourceWidget);
      // span 이 grid 끝 초과하지 않게 col clamp.
      const targetCol = Math.max(0, Math.min(GRID_COLS - span, col));
      const targetRow = row;
      setPositions((curr) => {
        const sourcePos = curr[sourceKey];
        if (!sourcePos) return curr;
        if (sourcePos.col === targetCol && sourcePos.row === targetRow)
          return curr;
        const next = { ...curr };
        // target footprint 안에 다른 widget 점유 셀이 있는지 확인 — 있으면
        // 그 widget 을 source 의 옛 자리로 swap.
        const overlapKeys = new Set<string>();
        for (let i = 0; i < span; i += 1) {
          const cellKey = `${targetCol + i},${targetRow}`;
          const occupant = occupiedCells.get(cellKey);
          if (occupant && occupant !== sourceKey) overlapKeys.add(occupant);
        }
        if (overlapKeys.size === 1) {
          // 단일 swap 시도 — overlap widget 을 source 옛 자리로
          const [overlapKey] = Array.from(overlapKeys);
          next[overlapKey] = { ...sourcePos };
        } else if (overlapKeys.size > 1) {
          // 여러 widget 겹침 — drop 거부 (간단 정책).
          return curr;
        }
        next[sourceKey] = { col: targetCol, row: targetRow };
        persist(next);
        return next;
      });
    },
    [dragKey, persist, widgetByKey, occupiedCells],
  );

  const onHandleDragEnd = useCallback(() => {
    setDragKey(null);
    setHoverCell(null);
  }, []);

  // pan 모드 cursor — `<html>` 에 data 속성 하나만 토글한다. globals.css 의
  // `html[data-canvas-pan="..."] *` 규칙이 정적으로 매칭되므로 React 가 동적
  // `<style>` 을 append/remove 하면서 생기는 1-frame race 가 사라진다
  // (PR #391/#392 잔존 flicker 의 root cause). dataset write 는 atomic — 매
  // mousemove 마다 호출되지도 않고, state 가 안 바뀌면 effect 자체가 안 돈다.
  useEffect(() => {
    const root = document.documentElement;
    if (isPanning) {
      root.dataset.canvasPan = 'grabbing';
    } else if (isSpaceHeld) {
      root.dataset.canvasPan = 'grab';
    } else {
      delete root.dataset.canvasPan;
    }
  }, [isPanning, isSpaceHeld]);

  // 언마운트 시 누수 방지.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.canvasPan;
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-3rem)] overflow-hidden bg-paper"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* 그리드 시각 노출 X — 사용자 피드백: "그리드가 UI적으로 보이지
          않도록". dot grid / 빈 cell border 모두 평소엔 안 보임. 드래그
          중에만 빈 cell 에 faint hint 노출 (아래 cell render 참고). */}
      <div className="absolute inset-0 flex items-start justify-center pt-8">
        <div
          ref={surfaceRef}
          className="relative"
          style={{
            width: SURFACE_W,
            height: SURFACE_H,
            // transform 은 applyTransform 이 imperative 하게 write — React style
            // prop 에 두면 zoom 등의 re-render 가 pan ref 갱신을 덮어쓴다.
            transformOrigin: 'center top',
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
            // GPU layer 사전 promote — 첫 pan 시 layer promotion stall 제거.
            willChange: 'transform',
          }}
        >
          {/* 빈 셀 — 드래그 중일 때만 시각화. 모든 cell 을 drop target 으로
              렌더 (점유 cell 의 drop event 는 그 위 widget card 가 먼저
              잡음). */}
          {Array.from({ length: GRID_ROWS }).flatMap((_, r) =>
            Array.from({ length: GRID_COLS }).map((__, c) => {
              const cellKey = `${c},${r}`;
              const isOccupied = occupiedCells.has(cellKey);
              if (isOccupied) return null;
              const isHover = hoverCell === cellKey && dragKey !== null;
              const showHint = dragKey !== null;
              return (
                <div
                  key={`empty-${cellKey}`}
                  data-canvas-cell
                  onDragOver={onCellDragOver(c, r)}
                  onDragLeave={onCellDragLeave(c, r)}
                  onDrop={onCellDrop(c, r)}
                  className="absolute rounded-md"
                  style={{
                    left: c * (CELL_W + GAP),
                    top: r * (CELL_H + GAP),
                    width: CELL_W,
                    height: CELL_H,
                    // 평소엔 완전 투명 (그리드 비가시).
                    // 드래그 중일 때만 옅은 dashed border 로 drop 가능 영역 hint.
                    border: showHint
                      ? '1px dashed var(--color-line-soft)'
                      : '1px solid transparent',
                    boxShadow: isHover
                      ? 'inset 0 0 0 2px var(--color-amore)'
                      : 'none',
                    transition: 'box-shadow 0.12s ease-out',
                  }}
                />
              );
            }),
          )}
          {/* 위젯 카드 — 절대 좌표 배치, expandedCols 만큼 span. */}
          {widgets.map((w) => {
            const pos = positions[w.key];
            if (!pos) return null;
            const span = spanOf(w);
            const width = expandedWidthOf(span);
            const isDragSource = dragKey === w.key;
            return (
              <div
                key={w.key}
                data-canvas-card
                data-widget-key={w.key}
                className="absolute rounded-md"
                onDragOver={onCellDragOver(pos.col, pos.row)}
                onDragLeave={onCellDragLeave(pos.col, pos.row)}
                onDrop={onCellDrop(pos.col, pos.row)}
                style={{
                  left: pos.col * (CELL_W + GAP),
                  top: pos.row * (CELL_H + GAP),
                  width,
                  height: CELL_H,
                  opacity: isDragSource ? 0.4 : 1,
                  transition: 'opacity 0.15s ease-out',
                }}
              >
                <WidgetShell
                  content={w}
                  dashboardMode
                  dragHandleProps={{
                    draggable: true,
                    onDragStart: onHandleDragStart(w.key),
                    onDragEnd: onHandleDragEnd,
                    onMouseDown: (e) => e.stopPropagation(),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
