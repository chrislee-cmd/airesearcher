'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. 대시보드 + pan + zoom-out + 자유 reposition.

   - 모든 위젯 항상 펼친 상태 (collapse 없음).
   - 3×3 widget-slot 그리드 — 한 슬롯 = 한 위젯 (CELL_W 816, CELL_H 800,
     GAP 48). CELL_W 816 = 6×5 시절 expandedCols=3 위젯 한 장의 visual
     width (3 × 240 + 2 × 48). 즉 위젯 크기 자체는 그대로 유지. SURFACE_W
     2544 = 3 × 816 + 2 × 48 (고정값, viewport 따라 reactive 하게 변하지
     않음). 위젯 메타의 expandedCols/expandedRows 는 canvas 안에서는 1×1
     로 강제 (모달·focus mode 같은 다른 컨텍스트에서만 본래 값 사용).
   - 디폴트 배치는 row-major — 6 위젯이면 1·2행에 3+3, 3행은 비움.
   - 빈 cell 들도 drop target — 위젯을 빈 영역으로 자유 이동 가능.
     다른 위젯과 겹치는 곳에 drop = 두 위젯 swap.
   - 빈 영역 drag = pan, 휠 = zoom-out (1.0 ~ 0.4, cursor focal point).
   - 위젯 header 영역 drag = 순서/위치 변경. localStorage 영속.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import type { WidgetContent } from '@/components/canvas/widget-types';

const GAP = 48;
const GRID_COLS = 3;
const GRID_ROWS = 3;
// CELL_W 816 — 6×5 시절 expandedCols=3 위젯 한 장의 visual width
// (3 × 240 + 2 × 48). 즉 위젯 자체의 크기는 변하지 않고, slot 단위만
// 6 cell→3 slot 으로 재정의된 것. viewport / zoom 과 무관하게 고정.
const CELL_W = 816;
const CELL_H = 800;
const SURFACE_W = GRID_COLS * CELL_W + (GRID_COLS - 1) * GAP; // 2544
const SURFACE_H = GRID_ROWS * CELL_H + (GRID_ROWS - 1) * GAP;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.0;
const ZOOM_FACTOR = 1.03;
// v1 좌표는 6×5 기준 — v2 bump 로 한 번 reset (디폴트 1·2행 3+3 배치).
const POSITIONS_STORAGE_KEY = 'canvas:dashboard-positions:v2';
const TRANSPARENT_GHOST_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type Coords = { col: number; row: number };
type Span = { cols: number; rows: number };

function expandedWidthOf(cols: number): number {
  return cols * CELL_W + (cols - 1) * GAP;
}

function expandedHeightOf(rows: number): number {
  return rows * CELL_H + (rows - 1) * GAP;
}

// wheel target 의 가장 가까운 scrollable parent 를 찾는다. `data-canvas-surface`
// marker 에 도달하면 위젯 밖 (= 캔버스 surface) 으로 간주하고 null 반환 — 캔버스
// 자체 pan/zoom 처리. 위젯 안에서 overflow auto/scroll + 실제 스크롤 여유가 있는
// element 를 만나면 그것을 반환 — native browser scroll 양보.
function findScrollableParent(
  target: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== boundary) {
    if (el.dataset.canvasSurface !== undefined) return null;
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    const ox = style.overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function spanOf(_w: WidgetContent | undefined): Span {
  // canvas 3×3 그리드에서는 한 슬롯 = 한 위젯. 위젯 메타의
  // expandedCols/expandedRows 는 다른 컨텍스트 (모달, focus mode) 용으로
  // 남겨두고 여기선 항상 1×1 로 강제.
  return { cols: 1, rows: 1 };
}

// 좌측 상단부터 row-major 로 위젯을 채움 — 점유 셀을 추적해 multi-row
// 위젯이 아래 row 를 미리 점유한 경우 그 셀들을 건너뜀.
function defaultPositions(widgets: WidgetContent[]): Record<string, Coords> {
  const out: Record<string, Coords> = {};
  const occupied = new Set<string>();
  let col = 0;
  let row = 0;
  for (const w of widgets) {
    const { cols, rows } = spanOf(w);
    while (row < GRID_ROWS) {
      if (col + cols > GRID_COLS) {
        col = 0;
        row += 1;
        continue;
      }
      if (row + rows > GRID_ROWS) break;
      let fits = true;
      for (let dc = 0; dc < cols && fits; dc += 1) {
        for (let dr = 0; dr < rows && fits; dr += 1) {
          if (occupied.has(`${col + dc},${row + dr}`)) fits = false;
        }
      }
      if (fits) break;
      col += 1;
    }
    out[w.key] = { col, row };
    for (let dc = 0; dc < cols; dc += 1) {
      for (let dr = 0; dr < rows; dr += 1) {
        occupied.add(`${col + dc},${row + dr}`);
      }
    }
    col += cols;
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
      // stored 좌표 채택 (valid widget + 전체 footprint 가 grid 안 +
      // 이미 채택된 위젯과 겹치지 않을 때만). multi-row 위젯이 grid 끝
      // 초과하는 stored 좌표 (예: 3-row 위젯이 row 13 시작 — §7 함정)
      // 는 여기서 reject 되고 아래 fallback 으로 빠짐.
      widgets.forEach((w) => {
        const p = stored[w.key];
        const { cols, rows } = spanOf(w);
        if (
          p &&
          typeof p.col === 'number' &&
          typeof p.row === 'number' &&
          p.col >= 0 &&
          p.col + cols <= GRID_COLS &&
          p.row >= 0 &&
          p.row + rows <= GRID_ROWS
        ) {
          let conflicts = false;
          for (let dc = 0; dc < cols && !conflicts; dc += 1) {
            for (let dr = 0; dr < rows && !conflicts; dr += 1) {
              if (occupied.has(`${p.col + dc},${p.row + dr}`)) conflicts = true;
            }
          }
          if (!conflicts) {
            merged[w.key] = { col: p.col, row: p.row };
            for (let dc = 0; dc < cols; dc += 1) {
              for (let dr = 0; dr < rows; dr += 1) {
                occupied.add(`${p.col + dc},${p.row + dr}`);
              }
            }
          }
        }
      });
      // stored 에 없거나 invalid 한 widget 은 빈 셀에 row-major 로 fallback.
      let cursorCol = 0;
      let cursorRow = 0;
      widgets.forEach((w) => {
        if (!valid.has(w.key)) return;
        if (merged[w.key]) return;
        const { cols, rows } = spanOf(w);
        while (cursorRow < GRID_ROWS) {
          if (cursorCol + cols > GRID_COLS) {
            cursorCol = 0;
            cursorRow += 1;
            continue;
          }
          if (cursorRow + rows > GRID_ROWS) break;
          let fits = true;
          for (let dc = 0; dc < cols && fits; dc += 1) {
            for (let dr = 0; dr < rows && fits; dr += 1) {
              if (occupied.has(`${cursorCol + dc},${cursorRow + dr}`)) {
                fits = false;
              }
            }
          }
          if (fits) {
            merged[w.key] = { col: cursorCol, row: cursorRow };
            for (let dc = 0; dc < cols; dc += 1) {
              for (let dr = 0; dr < rows; dr += 1) {
                occupied.add(`${cursorCol + dc},${cursorRow + dr}`);
              }
            }
            cursorCol += cols;
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

  // 점유 셀 Set — 빈 셀 렌더 + 충돌 감지에 사용. multi-row 위젯은
  // cols × rows footprint 의 모든 셀이 점유로 표시됨.
  const occupiedCells = useMemo(() => {
    const occ = new Map<string, string>(); // "c,r" → widget key
    Object.entries(positions).forEach(([k, p]) => {
      const { cols, rows } = spanOf(widgetByKey[k]);
      for (let dc = 0; dc < cols; dc += 1) {
        for (let dr = 0; dr < rows; dr += 1) {
          occ.set(`${p.col + dc},${p.row + dr}`, k);
        }
      }
    });
    return occ;
  }, [positions, widgetByKey]);

  // pan / zoom
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // 빈 영역 drag 가 즉시 pan 을 시작하면 텍스트 선택·셀 클릭 같은 자연스러운
  // 마우스 동작이 막힌다. 스페이스바를 누르고 있을 때만 pan 모드로 전환
  // (Figma·Miro 류 표준). 커서: 평소 default(arrow), space-held 시 grab,
  // drag 중엔 grabbing.
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Figma/Miro 표준 wheel 분기. React 의 synthetic onWheel 은 환경에 따라
  // passive 로 등록될 수 있어 preventDefault() 가 무시되므로 — trackpad
  // pinch (ctrlKey=true) 와 Cmd+wheel 의 browser-level page zoom 을 확실히
  // 막으려면 native 리스너를 { passive: false } 로 직접 부착한다. 핸들러는
  // 한 번만 부착하고 최신 zoom/pan 은 ref 로 읽어와 stale closure 회피.
  const zoomRef = useRef(zoom);
  const panRefValue = useRef(pan);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRefValue.current = pan;
  }, [pan]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      // 위젯 안 scrollable 영역의 wheel 이면 native browser scroll 양보 —
      // preventDefault / pan / zoom 모두 skip. shift+wheel · cmd+wheel 도
      // 위젯 안에선 native 동작 (위젯 안 수평 scroll 등) 으로 위임.
      if (findScrollableParent(e.target, container)) return;
      // ctrlKey: 명시적 Ctrl 또는 trackpad pinch (브라우저가 ctrlKey=true 로
      // emit). metaKey: Cmd (macOS).
      const isZoomGesture = e.ctrlKey || e.metaKey;
      e.preventDefault();
      if (isZoomGesture) {
        const currZoom = zoomRef.current;
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, currZoom * factor),
        );
        if (nextZoom === currZoom) return;
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / currZoom;
        const currPan = panRefValue.current;
        setPan({
          x: cx * (1 - ratio) + currPan.x * ratio,
          y: cy * (1 - ratio) + currPan.y * ratio,
        });
        setZoom(nextZoom);
        return;
      }
      setPan((p) => ({
        x: p.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: p.y - (e.shiftKey ? 0 : e.deltaY),
      }));
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // 스페이스바를 누르고 있을 때만 pan 시작. 그 외엔 위젯/셀 클릭 등 자연스러운
      // 마우스 동작을 막지 않는다 (위젯 헤더 drag-reposition 은 widget-shell 이
      // 자체 stopPropagation 으로 처리).
      if (!isSpaceHeld) return;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [pan, isSpaceHeld],
  );

  const onMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    setPan({
      x: panRef.current.panX + (e.clientX - panRef.current.startX),
      y: panRef.current.panY + (e.clientY - panRef.current.startY),
    });
  }, []);

  const onMouseUp = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

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
      const sourceSpan = spanOf(sourceWidget);
      // span 이 grid 끝 초과하지 않게 col/row clamp.
      const targetCol = Math.max(
        0,
        Math.min(GRID_COLS - sourceSpan.cols, col),
      );
      const targetRow = Math.max(
        0,
        Math.min(GRID_ROWS - sourceSpan.rows, row),
      );
      setPositions((curr) => {
        const sourcePos = curr[sourceKey];
        if (!sourcePos) return curr;
        if (sourcePos.col === targetCol && sourcePos.row === targetRow)
          return curr;
        const next = { ...curr };
        // target footprint (cols × rows) 안에 다른 widget 점유 셀이 있는지
        // 확인 — 단일 widget 만 겹치면 그 widget 을 source 의 옛 자리로 swap.
        const overlapKeys = new Set<string>();
        for (let dc = 0; dc < sourceSpan.cols; dc += 1) {
          for (let dr = 0; dr < sourceSpan.rows; dr += 1) {
            const cellKey = `${targetCol + dc},${targetRow + dr}`;
            const occupant = occupiedCells.get(cellKey);
            if (occupant && occupant !== sourceKey) overlapKeys.add(occupant);
          }
        }
        if (overlapKeys.size === 1) {
          const [overlapKey] = Array.from(overlapKeys);
          const overlapSpan = spanOf(widgetByKey[overlapKey]);
          // overlap widget 의 footprint 가 source 옛 자리에서 grid 밖으로
          // 나가면 swap 불가 — 거부.
          if (
            sourcePos.col + overlapSpan.cols > GRID_COLS ||
            sourcePos.row + overlapSpan.rows > GRID_ROWS
          ) {
            return curr;
          }
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

  // pan 모드 cursor 강제. JSX 안에 <style> 블록을 두면 매 렌더마다 React 가
  // 처리하면서 일시적으로 적용이 끊기는 frame 이 생겨 마우스 이동 중 flicker
  // 가 발생 (PR #391 회귀). 대신 useEffect 로 document.head 에 <style> 을
  // 한 번만 주입하고 body cursor 도 직접 세팅 — pan 모드 활성 동안 모든
  // 엘리먼트가 universal selector + !important 로 단일 cursor 를 유지.
  useEffect(() => {
    if (!isPanning && !isSpaceHeld) return;
    const cursor = isPanning ? 'grabbing' : 'grab';
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.cursor = cursor;
    const styleEl = document.createElement('style');
    styleEl.dataset.canvasPanCursor = '';
    styleEl.textContent = `*, *::before, *::after { cursor: ${cursor} !important; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.body.style.cursor = prevBodyCursor;
      styleEl.remove();
    };
  }, [isPanning, isSpaceHeld]);

  return (
    <div
      ref={containerRef}
      data-canvas
      className="relative h-full overflow-hidden"
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
          data-canvas-surface
          className="relative"
          style={{
            width: SURFACE_W,
            height: SURFACE_H,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center top',
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
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
                    // 평소엔 완전 투명 (점 grid 가 그대로 보임).
                    // 드래그 중에만 dashed border 로 drop 가능 영역 hint.
                    border: showHint
                      ? '1.5px dashed rgba(0, 0, 0, 0.35)'
                      : '1px solid transparent',
                    boxShadow: isHover
                      ? 'inset 0 0 0 3px var(--canvas-accent)'
                      : 'none',
                    transition: 'box-shadow 0.12s ease-out',
                  }}
                />
              );
            }),
          )}
          {/* 위젯 카드 — 절대 좌표 배치, expandedCols × expandedRows 만큼 span. */}
          {widgets.map((w) => {
            const pos = positions[w.key];
            if (!pos) return null;
            const { cols, rows } = spanOf(w);
            const width = expandedWidthOf(cols);
            const height = expandedHeightOf(rows);
            const isDragSource = dragKey === w.key;
            return (
              <div
                key={w.key}
                data-canvas-card
                data-widget-key={w.key}
                className="absolute"
                onDragOver={onCellDragOver(pos.col, pos.row)}
                onDragLeave={onCellDragLeave(pos.col, pos.row)}
                onDrop={onCellDrop(pos.col, pos.row)}
                style={{
                  left: pos.col * (CELL_W + GAP),
                  top: pos.row * (CELL_H + GAP),
                  width,
                  height,
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
