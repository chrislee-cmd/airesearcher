'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. Miro / n8n 풍 navigatable 캔버스.

   - 외곽 viewport (overflow-hidden) + 중앙 grid surface (transform 으로
     pan/zoom). 마우스 wheel 로 zoom (Ctrl/Cmd 없이도), 빈 영역 drag 으로
     pan. 카드 위 드래그는 pan 안 함 (data-canvas-card 가드).
   - 그리드: 5×5 슬롯. 각 row 는 flex 컨테이너 — 빈 슬롯은 placeholder
     div, 점유 슬롯은 WidgetShell. expand 시 widget 너비 480 → flex 자연
     push (이웃 슬롯 우측 이동, overlap 안 됨).
   - 상태 모델: positions: Record<key, {col, row}> — col 은 그 row 안에서
     widget 의 슬롯 인덱스. 한 셀에 1 widget invariant.
   - B-2 multi-expand: 여러 카드 동시 expand 가능. 같은 row 안에서 push,
     row 사이엔 영향 X.
   - 위치 영속: localStorage('canvas:widget-positions:v2'), mount 시 hydrate.
   - reorder: 카드 헤더/타일 어디든 잡고 드래그 (widget-shell 의 dragHandleProps).
     빈 슬롯 drop = 이동, 다른 위젯 위 drop = swap.
   - 드래그 ghost: 투명 1×1 image — zoom 시 native 크기로 보이는 "확대"
     이슈 회피. 시각 피드백은 source opacity 0.4 + drop target ring.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import type { WidgetContent } from '@/components/canvas/widget-types';

// zoom 비활성화 (scale=1 고정) — MIN_ZOOM / MAX_ZOOM / ZOOM_FACTOR 는 제거.
// 필요 시 wheel handler 와 함께 복원.
const CARD_W_COLLAPSED = 240;
const CELL_GAP = 48;
// 위젯별 expand 너비는 meta.expandedCols (1/2/3) 로 변동.
// expandedWidth(n) = n * CARD_W_COLLAPSED + (n-1) * CELL_GAP
function expandedWidthOf(cols: 1 | 2 | 3): number {
  return cols * CARD_W_COLLAPSED + (cols - 1) * CELL_GAP;
}
const GRID_COLS = 6;
const GRID_ROWS = 8;
const PITCH = CARD_W_COLLAPSED + CELL_GAP; // 288
const GRID_W = GRID_COLS * CARD_W_COLLAPSED + (GRID_COLS - 1) * CELL_GAP;
const GRID_H = GRID_ROWS * CARD_W_COLLAPSED + (GRID_ROWS - 1) * CELL_GAP;
const POSITIONS_STORAGE_KEY = 'canvas:widget-positions:v2';
// 투명 1×1 gif — drag ghost 로 setDragImage 에 사용 (브라우저 기본 ghost
// 비활성화 효과). 모듈 스코프 1회 생성.
const TRANSPARENT_GHOST_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type Coords = { col: number; row: number };

// 첫 사용자(localStorage 비어있음) 의 default 배치 — 캔버스 중앙 row 에
// 가로로 N 위젯을 centered 정렬. row 는 약간 위쪽 (floor((R-1)/2)) 으로
// 잡아서 expand 시 본문이 아래로 자랄 여유 확보.
function defaultPositions(widgets: WidgetContent[]): Record<string, Coords> {
  const out: Record<string, Coords> = {};
  const N = widgets.length;
  const startCol = Math.max(0, Math.floor((GRID_COLS - N) / 2));
  const centerRow = Math.floor((GRID_ROWS - 1) / 2);
  widgets.forEach((w, i) => {
    const col = (startCol + i) % GRID_COLS;
    const rowOffset = Math.floor((startCol + i) / GRID_COLS);
    out[w.key] = { col, row: centerRow + rowOffset };
  });
  return out;
}

export function CanvasBoard({
  widgets,
  initialFocus,
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
}) {
  const initial =
    initialFocus && widgets.some((w) => w.key === initialFocus)
      ? initialFocus
      : (widgets[0]?.key ?? null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    initial ? new Set([initial]) : new Set(),
  );

  const [positions, setPositions] = useState<Record<string, Coords>>(() =>
    defaultPositions(widgets),
  );
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, Coords>;
      if (typeof stored !== 'object' || stored === null) return;
      const merged: Record<string, Coords> = {};
      const occupied = new Set<string>();
      widgets.forEach((w) => {
        const p = stored[w.key];
        if (
          p &&
          typeof p.col === 'number' &&
          typeof p.row === 'number' &&
          p.col >= 0 &&
          p.col < GRID_COLS &&
          p.row >= 0 &&
          p.row < GRID_ROWS
        ) {
          merged[w.key] = { col: p.col, row: p.row };
          occupied.add(`${p.col},${p.row}`);
        }
      });
      let cursor = 0;
      widgets.forEach((w) => {
        if (merged[w.key]) return;
        while (cursor < GRID_COLS * GRID_ROWS) {
          const col = cursor % GRID_COLS;
          const row = Math.floor(cursor / GRID_COLS);
          cursor += 1;
          if (!occupied.has(`${col},${row}`)) {
            merged[w.key] = { col, row };
            occupied.add(`${col},${row}`);
            break;
          }
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
      window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode — 메모리 상태만 유지 */
    }
  }, []);

  const widgetByKey = useMemo(
    () => Object.fromEntries(widgets.map((w) => [w.key, w])),
    [widgets],
  );

  const widgetAtCell = useMemo(() => {
    const m: Record<string, string> = {};
    Object.entries(positions).forEach(([key, p]) => {
      m[`${p.col},${p.row}`] = key;
    });
    return m;
  }, [positions]);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // viewport ref — expand 시 widget 의 실제 화면 위치 측정용.
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  // 투명 ghost 이미지 — mount 시 1회 prepare. 브라우저는 setDragImage 호출
  // 시 image element 가 로드된 상태여야 함 (Safari 일부 케이스).
  const ghostRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.src = TRANSPARENT_GHOST_SRC;
    ghostRef.current = img;
  }, []);

  // wide zoom — viewport 너비 기준 동적 계산. height 무시 (6×8 그리드는
  // 세로로 길어서 full-fit 시 zoom 이 0.3 대로 작아짐 — "조금 더 가깝게"
  // 피드백 반영). 사용자는 wide 에서도 세로 pan 으로 하단 row 접근 가능.
  // 0.55~0.8 clamp 로 적정 사이즈 유지.
  const [wideZoom, setWideZoom] = useState(0.7);
  useEffect(() => {
    const recompute = () => {
      const el = containerRef.current;
      if (!el) return;
      const next = el.clientWidth / (GRID_W * 1.05);
       
      setWideZoom(Math.max(0.55, Math.min(0.8, next)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  // 위젯 펼침 시 viewport 중앙으로 pan — DOM rect 측정으로 정확한 visual
  // center 계산 (zoom transition + body 펼침 + flex push 모두 반영).
  const centerOnWidget = useCallback((key: string) => {
    const container = containerRef.current;
    if (!container) return;
    const widget = container.querySelector(
      `[data-widget-key="${key}"]`,
    ) as HTMLElement | null;
    if (!widget) return;
    const cr = container.getBoundingClientRect();
    const wr = widget.getBoundingClientRect();
    const dx = cr.left + cr.width / 2 - (wr.left + wr.width / 2);
    const dy = cr.top + cr.height / 2 - (wr.top + wr.height / 2);
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const expandTo = useCallback(
    (key: string) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      // close-up: zoom 1 + viewport 중앙. zoom transition (0.28s) + body
      // 펼침 (0.32s) + flex reflow 끝나는 ~360ms 후 widget rect 측정 → pan.
      setZoom(1);
      window.setTimeout(() => centerOnWidget(key), 360);
    },
    [centerOnWidget],
  );

  const collapseKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // 모든 위젯 닫힘 → wide view 복귀 (zoom = wideZoom, pan 0).
  useEffect(() => {
    if (expandedKeys.size === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- wide view reset
      setZoom(wideZoom);
       
      setPan({ x: 0, y: 0 });
    }
  }, [expandedKeys, wideZoom]);

  // 초기 mount — initialFocus 위젯이 있으면 중앙 정렬.
  useEffect(() => {
    const initial = Array.from(expandedKeys)[0];
    if (!initial) return;
    const id = window.setTimeout(() => centerOnWidget(initial), 360);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    // 카드 위 휠 = 본문 자연 스크롤 우선 (PR #358 격리 유지).
    // 캔버스 zoom 은 비활성화 — 사용자 피드백: zoom 동작이 불편해서 위젯
    // 크기를 적정 사이즈로 고정 (scale=1). pan 은 빈 영역 drag 으로 제공.
    // wheel 이벤트는 캔버스 위에서 아무 동작 안 함 (page scroll 도 viewport
    // overflow-hidden 이라 영향 X).
    if ((e.target as HTMLElement).closest('[data-canvas-card]')) return;
  }, []);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-canvas-card]')) return;
      if (el.closest('[data-canvas-cell]')) return;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [pan],
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

  // ── 위치 변경 dnd ────────────────────────────────────────────────────
  const onGripDragStart = useCallback(
    (key: string) => (e: ReactDragEvent<HTMLElement>) => {
      e.stopPropagation();
      // 투명 ghost 사용 — 기본 드래그 프리뷰가 zoom 무시한 native 크기로
      // 노출되는 "확대" 현상 회피. 시각 피드백은 source opacity + cell ring.
      if (ghostRef.current) {
        try {
          e.dataTransfer.setDragImage(ghostRef.current, 0, 0);
        } catch {
          /* Firefox 등 일부 환경에서 setDragImage 가 throw — 무시 */
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
      setPositions((curr) => {
        const sourcePos = curr[sourceKey];
        if (!sourcePos) return curr;
        if (sourcePos.col === col && sourcePos.row === row) return curr;
        const next = { ...curr };
        const occupant = Object.keys(next).find(
          (k) =>
            k !== sourceKey &&
            next[k].col === col &&
            next[k].row === row,
        );
        if (occupant) next[occupant] = { ...sourcePos };
        next[sourceKey] = { col, row };
        persist(next);
        return next;
      });
    },
    [dragKey, persist],
  );

  const onGripDragEnd = useCallback(() => {
    setDragKey(null);
    setHoverCell(null);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-3rem)] overflow-hidden bg-paper"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
    >
      {/* 배경 dot-grid — 캔버스 "paper texture" 톤. opacity 매우 낮춰서
          cell border 와 시각 충돌 X (이전 0.06 → 0.025). pan 시 함께 이동해서
          surface 이동 감각 살림. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(29,27,32,0.025) 1px, transparent 1px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="flex flex-col"
          style={{
            width: GRID_W,
            minHeight: GRID_H,
            gap: `${CELL_GAP}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
          }}
        >
          {/* row 컨테이너 — 안쪽은 flex row (horizontal push), 바깥쪽 outer
              는 flex column (vertical push). expand 로 widget 본문이 자라면
              그 row 의 높이가 늘고, 뒤 row 들이 자연스럽게 아래로 밀림. */}
          {Array.from({ length: GRID_ROWS }).map((_, r) => (
            <div
              key={`row-${r}`}
              className="flex items-start"
              style={{
                gap: `${CELL_GAP}px`,
              }}
            >
              {Array.from({ length: GRID_COLS }).map((__, c) => {
                const cellKey = `${c},${r}`;
                const occupantKey = widgetAtCell[cellKey];
                const isHover =
                  hoverCell === cellKey && dragKey !== occupantKey;
                const showHint = dragKey !== null;
                if (occupantKey) {
                  const w = widgetByKey[occupantKey];
                  if (!w) return null;
                  const isExpanded = expandedKeys.has(occupantKey);
                  const isDragSource = dragKey === occupantKey;
                  return (
                    <div
                      key={`slot-${cellKey}`}
                      data-canvas-card
                      data-widget-key={occupantKey}
                      onDragOver={onCellDragOver(c, r)}
                      onDragLeave={onCellDragLeave(c, r)}
                      onDrop={onCellDrop(c, r)}
                      className="rounded-md"
                      style={{
                        flexShrink: 0,
                        width: isExpanded
                          ? expandedWidthOf(w.meta.expandedCols ?? 2)
                          : CARD_W_COLLAPSED,
                        minHeight: CARD_W_COLLAPSED,
                        opacity: isDragSource ? 0.4 : 1,
                        boxShadow: isHover
                          ? '0 0 0 2px var(--color-amore)'
                          : 'none',
                        transition:
                          'width 0.3s ease-out, opacity 0.15s ease-out, box-shadow 0.12s ease-out',
                      }}
                    >
                      <WidgetShell
                        content={w}
                        expanded={isExpanded}
                        onExpand={() => expandTo(occupantKey)}
                        onCollapse={() => collapseKey(occupantKey)}
                        dragHandleProps={{
                          draggable: true,
                          onDragStart: onGripDragStart(occupantKey),
                          onDragEnd: onGripDragEnd,
                          onMouseDown: (e) => e.stopPropagation(),
                        }}
                      />
                    </div>
                  );
                }
                // 빈 슬롯 — drop target placeholder. 항상 faint border +
                // 살짝 어두운 bg + 안쪽 그림자로 "패인 자리" 입체감. 드래그
                // 중엔 dashed + 진한 색, hover 시 amore inset ring.
                return (
                  <div
                    key={`empty-${cellKey}`}
                    data-canvas-cell
                    onDragOver={onCellDragOver(c, r)}
                    onDragLeave={onCellDragLeave(c, r)}
                    onDrop={onCellDrop(c, r)}
                    className="rounded-md bg-paper-soft"
                    style={{
                      flexShrink: 0,
                      width: CARD_W_COLLAPSED,
                      height: CARD_W_COLLAPSED,
                      border: showHint
                        ? '1px dashed var(--color-line)'
                        : '1px solid var(--color-line-soft)',
                      boxShadow: isHover
                        ? 'inset 0 0 0 2px var(--color-amore)'
                        : 'inset 0 1px 2px rgba(29,27,32,0.04)',
                      transition:
                        'box-shadow 0.12s ease-out, border-color 0.2s ease-out',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
