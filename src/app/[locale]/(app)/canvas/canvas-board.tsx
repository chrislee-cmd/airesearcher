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
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import { WidgetStatesMapProvider } from '@/components/canvas/shell/widget-state-context';
import { SidebarNav } from '@/components/canvas/shell/sidebar-nav';
import { FullviewShellProvider } from '@/components/canvas/shell/fullview-shell-context';
import { Modal } from '@/components/ui/modal';
import type { WidgetContent } from '@/components/canvas/widget-types';
import { WidgetNavigator } from './widget-navigator';

const GAP = 48;
// 2×3 row-major 배치 — 6 visible 위젯이 2열 × 3행에 정확히 채워짐
// (Row1 recruiting|desk, Row2 probing|translate, Row3 quotes|interviews).
// visibility.ts CANVAS_ORDER 가 이 순서를 정의.
const GRID_COLS = 2;
const GRID_ROWS = 3;
// CELL_W 816 — 6×5 시절 expandedCols=3 위젯 한 장의 visual width
// (3 × 240 + 2 × 48). 즉 위젯 자체의 크기는 변하지 않고, slot 단위만
// 6 cell→3 slot 으로 재정의된 것. viewport / zoom 과 무관하게 고정.
const CELL_W = 816;
const CELL_H = 950;
const SURFACE_W = GRID_COLS * CELL_W + (GRID_COLS - 1) * GAP; // 2 × 816 + 48 = 1680
const SURFACE_H = GRID_ROWS * CELL_H + (GRID_ROWS - 1) * GAP;
// MIN_ZOOM 0.3 — fit-to-view (6 위젯 한눈) 가 작은 viewport (1440×900 +
// 사이드바 280px → 본문 1160×800) 에서도 clamp 없이 안착하려면 0.3 까지
// 허용해야 함. 이전 0.4 였으나 height 축에서 ~14% 잘렸음. 위젯 안 텍스트는
// 0.3 에서도 줌-아웃 미니맵 톤으로 판독 가능.
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.0;
const ZOOM_FACTOR = 1.03;
// v1 = 6×5, v2 = 3×3 (1·2행 3+3). v3 = 2×3 row-major 재배치로 한 번 더 reset —
// 옛 커스텀 좌표를 버리고 신 layout 을 강제 적용 (사용자 결정: 초기화 의도).
const POSITIONS_STORAGE_KEY = 'canvas:dashboard-positions:v3';
const TRANSPARENT_GHOST_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 행별 헤더 톤 — Row 0 강조(amore) → Row 1 mid(ink-2) → Row 2 subdued(mute).
// 같은 행의 두 위젯은 동일 톤. wrapper 에 CSS 변수로 주입하면 widget-shell
// 헤더의 inline background/border fallback 이 이를 참조한다. 사용자가
// per-widget 색(WidgetHeaderColorPicker)을 지정하면 그 inline 값이 우선하고,
// 미지정 위젯만 이 행 색으로 렌더된다. 모든 색은 design-system 토큰.
const ROW_HEADER_TONE: Record<number, { bg: string; border: string }> = {
  0: { bg: 'var(--color-amore-bg)', border: 'var(--color-amore)' },
  1: { bg: 'var(--color-paper-soft)', border: 'var(--color-ink-2)' },
  2: { bg: 'var(--color-mute-bg)', border: 'var(--color-mute)' },
};

// "전체 보기" 진입은 이제 모든 위젯이 공유 모달(아래 FullviewShell)을 연다.
// WidgetShell 의 "전체 보기" 버튼 → onFullview → openFullview(key) → 공유
// 모달이 그 위젯의 본문을 slot 으로 받는다. 각 위젯 본문은 자기가 currentKey
// 일 때만 본문을 portal 하므로 단일 인스턴스가 유지되고, 카드는 모달이 열려도
// unmount 되지 않아 실시간 세션(probing/translate)이 swap·close 후에도 보존된다
// (옛 위젯별 `<key>:open-fullview` 이벤트 + provider hoist 불필요).

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
  initialFocus,
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

  // ── 공유 전체보기 모달 (shared fullview shell) ──────────────────────
  // 단일 <Modal> + 좌측 SidebarNav + 우측 본문 slot. 각 위젯 ExpandedBody
  // 가 자기가 currentKey 일 때만 본문을 slot 으로 portal (fullview-shell-
  // context). 카드는 모달이 열려도 unmount 되지 않으므로 실시간 세션
  // (probing / translate) 이 위젯 swap·모달 close 후에도 보존된다. close
  // 시 currentKey 는 보존 → 다음 open 때 마지막 본 위젯으로 복귀.
  const [fullviewOpen, setFullviewOpen] = useState(false);
  const [currentWidgetKey, setCurrentWidgetKey] = useState<string | null>(null);
  const [fullviewSlotEl, setFullviewSlotEl] = useState<HTMLElement | null>(
    null,
  );

  const openFullview = useCallback((key: string) => {
    setCurrentWidgetKey(key);
    setFullviewOpen(true);
  }, []);
  const switchFullview = useCallback((key: string) => {
    setCurrentWidgetKey(key);
  }, []);
  const closeFullview = useCallback(() => {
    setFullviewOpen(false);
  }, []);

  const fullviewValue = useMemo(
    () => ({
      currentKey: currentWidgetKey,
      open: fullviewOpen,
      slotEl: fullviewSlotEl,
      openFullview,
      switchTo: switchFullview,
      close: closeFullview,
    }),
    [
      currentWidgetKey,
      fullviewOpen,
      fullviewSlotEl,
      openFullview,
      switchFullview,
      closeFullview,
    ],
  );

  // 사이드바 단축키 1-N — 모달 open 시에만 (canvas pan/zoom 단축키와 충돌
  // 회피). 모달 안 input / textarea / contenteditable 입력 중에는 무시.
  useEffect(() => {
    if (!fullviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number.parseInt(e.key, 10) - 1;
        const target = widgets[idx];
        if (target) {
          e.preventDefault();
          setCurrentWidgetKey(target.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullviewOpen, widgets]);

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
  // 위젯 헤더 mouseDown/dragStart 안에서 최신 isSpaceHeld 를 읽기 위한 ref.
  // dragHandleProps 는 widget 별로 spread 되므로 state 직접 참조 시 stale
  // closure 위험 — ref 로 우회.
  const isSpaceHeldRef = useRef(isSpaceHeld);
  useEffect(() => {
    isSpaceHeldRef.current = isSpaceHeld;
  }, [isSpaceHeld]);
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

  // ── focus (Navigator click / ?focus= query / 자동 갱신) ─────────────
  // focusedKey: 현재 시각적 중심에 있는 위젯 (Navigator highlight 용).
  // wheel pan/zoom 시 자동 갱신 — 클릭이 아니라 단순 derived state.
  const [focusedKey, setFocusedKey] = useState<string | null>(
    initialFocus && widgetByKey[initialFocus] ? initialFocus : null,
  );

  // 위젯 키 → 위젯이 surface 안에서 차지하는 center (x, y). pan/zoom 무관한
  // 순수 좌표 — 자동 갱신과 click focus 양쪽에서 공유.
  const widgetCenter = useCallback(
    (key: string) => {
      const pos = positions[key];
      if (!pos) return null;
      const span = spanOf(widgetByKey[key]);
      return {
        x:
          pos.col * (CELL_W + GAP) +
          (span.cols * CELL_W + (span.cols - 1) * GAP) / 2,
        y:
          pos.row * (CELL_H + GAP) +
          (span.rows * CELL_H + (span.rows - 1) * GAP) / 2,
      };
    },
    [positions, widgetByKey],
  );

  // 클릭 jump — 위젯이 화면에 완전히 들어가는 fit zoom 계산 + 중앙 정렬.
  // 예전엔 targetZoom = 1.0 하드코딩이라 위젯(816×950)이 container 보다 크면
  // 짤리고 "너무 클로즈업" 됐다. 이제 위젯 실 픽셀 크기 대비 container 비율로
  // 축소해 전체를 노출한다.
  // 좌표계: surface 는 flex 로 컨테이너 가로 중앙에 배치되고 transformOrigin
  // 은 'center top'. 따라서 widget 중심을 컨테이너 중심으로 끌어오는 pan 은
  //   pan.x = (SURFACE_W/2 - widgetX) * targetZoom
  //   pan.y = containerHeight/2 - SURFACE_PT - widgetY * targetZoom
  // (transformOrigin 미적용 시 식이 다른 함정 — §7 의 transformOrigin 함정).
  const focusWidget = useCallback(
    (key: string) => {
      const center = widgetCenter(key);
      const widget = widgetByKey[key];
      const container = containerRef.current;
      if (!center || !widget || !container) return;
      const rect = container.getBoundingClientRect();
      const SURFACE_PT = 32; // pt-8 = 32px (surface 컨테이너의 top offset)

      // 위젯이 surface 안에서 차지하는 실제 픽셀 크기. widgetCenter 와 동일한
      // spanOf + CELL/GAP 좌표계 — 스펙 예시의 widget.width/height 는 이 코드엔
      // 없어 spanOf 기반으로 보수적으로 계산 (현재 spanOf = 항상 1×1 → 816×950).
      const span = spanOf(widget);
      const widgetW = span.cols * CELL_W + (span.cols - 1) * GAP;
      const widgetH = span.rows * CELL_H + (span.rows - 1) * GAP;

      // 위젯이 container 안에 15% 여백(PADDING) 두고 완전히 들어가는 최대 zoom.
      // max 1.0 = 작은 위젯도 100% 초과 확대 안 함. min 0.3 = 극단 축소 방지.
      const PADDING = 0.85;
      const containerW = rect.width;
      const containerH = rect.height - SURFACE_PT;
      const fitZoom = Math.min(
        (containerW / widgetW) * PADDING,
        (containerH / widgetH) * PADDING,
        1.0,
      );
      const targetZoom = Math.max(0.3, fitZoom);

      const targetPan = {
        x: (SURFACE_W / 2 - center.x) * targetZoom,
        y: rect.height / 2 - SURFACE_PT - center.y * targetZoom,
      };
      setZoom(targetZoom);
      setPan(targetPan);
      setFocusedKey(key);
    },
    [widgetCenter, widgetByKey],
  );

  // mount 시 ?focus= query 가 있으면 자동 focus (deep-link). 단 한 번만 fire —
  // localStorage 좌표 hydration effect 가 positions 를 update 한 뒤에 정확한
  // 좌표로 jump 하도록 positions/focusWidget 를 deps 에 포함하고 ref 로 latch.
  // probing 만 특별 — focus + 모달 자동 open + URL `focus=probing` 제거.
  // 이유: probing 위젯의 "전체보기" 는 풀-모달 인터랙션이라 URL 에
  // `focus=probing` 이 남아 있으면 사용자가 모달을 페이지로 오인하고
  // 브라우저 백버튼을 누르면 canvas 밖으로 navigate 되어 컨텍스트를
  // 잃는다. replaceState 로 즉시 정리하면 모달 닫기 = ESC/✕/backdrop,
  // 백버튼 = canvas 진입 이전으로 깨끗하게 분리.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (!initialFocus) {
      didInitialFocusRef.current = true;
      return;
    }
    if (!widgetByKey[initialFocus] || !positions[initialFocus]) return;
    didInitialFocusRef.current = true;
    const id = requestAnimationFrame(() => {
      focusWidget(initialFocus);
      if (initialFocus === 'probing') {
        openFullview('probing');
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('focus');
          const next = url.pathname + (url.search || '') + url.hash;
          window.history.replaceState(window.history.state, '', next);
        } catch {
          /* URL 조작 실패 — 모달은 open, URL 만 더러운 채로 진행 */
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [initialFocus, widgetByKey, positions, focusWidget, openFullview]);

  // ── fit-to-view default zoom ─────────────────────────────────────────
  // 로그인 후 /canvas 진입 시 surface 부분만 보이던 zoom=1.0 default 를
  // 위젯 bounding box 가 한 화면에 들어가는 scale 로 자동 조정. 한 mount =
  // 한 번만 fire (ref latch). `?focus=` query 가 있으면 fit 생략 — 위 effect
  // 의 focusWidget 가 pan/zoom 직접 세팅. localStorage 좌표 hydration 이
  // setPositions 로 positions 를 갱신하면 rAF 콜백이 그 시점 positions 를
  // 읽도록 effect 가 positions 변화에 재실행되지만 latch 로 단발 보장.
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (initialFocus) {
      didInitialFitRef.current = true;
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const id = requestAnimationFrame(() => {
      if (didInitialFitRef.current) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // 현재 positions 의 widget bounding box. 6 위젯 3+3 default 면
      // 0..2 col × 0..1 row = 2544 × 1948 (3행은 비어 있어 height 절약).
      let minCol = GRID_COLS;
      let maxCol = -1;
      let minRow = GRID_ROWS;
      let maxRow = -1;
      widgets.forEach((w) => {
        const pos = positions[w.key];
        if (!pos) return;
        const { cols, rows } = spanOf(w);
        if (pos.col < minCol) minCol = pos.col;
        if (pos.col + cols - 1 > maxCol) maxCol = pos.col + cols - 1;
        if (pos.row < minRow) minRow = pos.row;
        if (pos.row + rows - 1 > maxRow) maxRow = pos.row + rows - 1;
      });
      if (maxCol < 0 || maxRow < 0) return; // 위젯 0개 → skip

      const colSpan = maxCol - minCol + 1;
      const rowSpan = maxRow - minRow + 1;
      const boxWidth = colSpan * CELL_W + (colSpan - 1) * GAP;
      const boxHeight = rowSpan * CELL_H + (rowSpan - 1) * GAP;
      const boxCenterX = minCol * (CELL_W + GAP) + boxWidth / 2;
      const boxCenterY = minRow * (CELL_H + GAP) + boxHeight / 2;

      const PADDING = 64; // 양옆/위아래 여백
      const SURFACE_PT = 32; // pt-8 (surface 컨테이너 top offset)
      const scaleX = (rect.width - PADDING * 2) / boxWidth;
      const scaleY = (rect.height - PADDING * 2) / boxHeight;
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(scaleX, scaleY, MAX_ZOOM),
      );

      // surface 는 flex 로 컨테이너 가로 중앙 배치 + transformOrigin
      // 'center top'. focusWidget 와 동일 좌표식 — bounding box 중심을
      // 컨테이너 중심으로 끌어옴.
      const targetPan = {
        x: (SURFACE_W / 2 - boxCenterX) * fitZoom,
        y: rect.height / 2 - SURFACE_PT - boxCenterY * fitZoom,
      };
      setZoom(fitZoom);
      setPan(targetPan);
      didInitialFitRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [initialFocus, widgets, positions]);

  // 자동 갱신 — pan/zoom 가 바뀔 때마다 컨테이너 중심에 가장 가까운 위젯을
  // focusedKey 로 설정. 사용자가 wheel pan/zoom 으로 다른 위젯에 가면
  // Navigator highlight 가 따라옴.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const SURFACE_PT = 32;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    let bestKey: string | null = null;
    let bestDist = Infinity;
    widgets.forEach((w) => {
      const c = widgetCenter(w.key);
      if (!c) return;
      // widget 의 화면상 중심 좌표 (transformOrigin: 'center top' 보정)
      const sx = centerX + (c.x - SURFACE_W / 2) * zoom + pan.x;
      const sy = SURFACE_PT + c.y * zoom + pan.y;
      const dist = Math.hypot(sx - centerX, sy - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = w.key;
      }
    });
    if (bestKey && bestKey !== focusedKey) {
      setFocusedKey(bestKey);
    }
  }, [pan, zoom, widgets, widgetCenter, focusedKey]);

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
    <WidgetStatesMapProvider>
    <FullviewShellProvider value={fullviewValue}>
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
      <WidgetNavigator
        widgets={widgets}
        focusedKey={focusedKey}
        onFocus={focusWidget}
      />
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
            // 행별 헤더 톤 — 실제 시각적 행(pos.row) 기준. 위젯을 다른 행으로
            // 드래그하면 새 행 색을 따라간다 (위젯 정체성이 아니라 위치 기준).
            const tone = ROW_HEADER_TONE[pos.row] ?? ROW_HEADER_TONE[0];
            return (
              <div
                key={w.key}
                data-canvas-card
                data-widget-key={w.key}
                data-canvas-row={pos.row}
                className="absolute"
                onDragOver={onCellDragOver(pos.col, pos.row)}
                onDragLeave={onCellDragLeave(pos.col, pos.row)}
                onDrop={onCellDrop(pos.col, pos.row)}
                style={
                  {
                    left: pos.col * (CELL_W + GAP),
                    top: pos.row * (CELL_H + GAP),
                    width,
                    height,
                    opacity: isDragSource ? 0.4 : 1,
                    transition: 'opacity 0.15s ease-out',
                    '--widget-header-row-bg': tone.bg,
                    '--widget-header-row-border': tone.border,
                  } as CSSProperties
                }
              >
                <WidgetShell
                  content={w}
                  dashboardMode
                  onFullview={() => openFullview(w.key)}
                  dragHandleProps={{
                    draggable: true,
                    onDragStart: (e) => {
                      // 스페이스바 hold 면 헤더 drag 중단 → 캔버스 pan 우선
                      // (Figma/Miro 표준). HTML5 dragstart 는 mouseDown 과
                      // 별개 fire 가능하므로 preventDefault 로 차단.
                      if (isSpaceHeldRef.current) {
                        e.preventDefault();
                        return;
                      }
                      onHandleDragStart(w.key)(e);
                    },
                    onDragEnd: onHandleDragEnd,
                    onMouseDown: (e) => {
                      // 스페이스바 hold 면 stopPropagation 생략 → 이벤트가
                      // 상위 캔버스로 버블링되어 pan 이 시작.
                      if (isSpaceHeldRef.current) return;
                      e.stopPropagation();
                    },
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>

    {/* ── 공유 전체보기 모달 ─────────────────────────────────────────
        단일 Modal: 좌 SidebarNav (위젯 전환) + 우 slot (현재 위젯 본문이
        portal 됨). 헤더(제목/닫기×)는 각 위젯의 WidgetFullviewPanel 이
        소유 → 동적 subtitle 유지. size="wide" — 90vw×90vh, Memphis 팝업
        (backdrop 보이는 모달, 프로빙 어시스턴트 원래 톤). backdrop /
        Esc 닫기는 Modal 이 처리. */}
    <Modal
      open={fullviewOpen && !!currentWidgetKey}
      onClose={closeFullview}
      size="wide"
    >
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        <SidebarNav
          widgets={widgets}
          current={currentWidgetKey}
          onSwitch={switchFullview}
        />
        <div
          ref={setFullviewSlotEl}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        />
      </div>
    </Modal>
    </FullviewShellProvider>
    </WidgetStatesMapProvider>
  );
}
