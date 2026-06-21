'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. Miro / n8n 풍 navigatable 캔버스.

   - 외곽 viewport (overflow-hidden) + 중앙 grid surface (transform 으로
     pan/zoom). 마우스 wheel 로 zoom (Ctrl/Cmd 없이도), 빈 영역 drag 으로
     pan. 카드 위 드래그는 pan 안 함 (data-canvas-card 가드).
   - 그리드: 3-col, gridAutoRows 360px (정사각형 셀). 카드가 자기 슬롯
     안에서 in-place expand (col-span-2 row-span-2).
   - B-2 1-expanded 모델 유지: 다른 카드 클릭 시 직전 expanded auto-
     collapse. deep-link focus param 으로 초기 expanded 카드 결정.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import type { WidgetContent } from '@/components/canvas/widget-types';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.04;
// Flex row layout — 각 row 가 독립 flex container. 카드 expanded 시 width
// 480 으로 자라면 같은 row 의 우측 카드들이 자연스럽게 push. row 사이엔
// 영향 X — 카드들이 자기 row 슬롯 유지. CSS grid auto-flow 의 center
// reshuffle (merge) 도, absolute 의 overlap 도 모두 회피.
const CARD_W_COLLAPSED = 240;
const CARD_W_EXPANDED = 480;
const CELL_GAP = 48;
const GRID_COLS = 3;
const PITCH = CARD_W_COLLAPSED + CELL_GAP; // 288 — collapsed 시 카드 중심 거리

export function CanvasBoard({
  widgets,
  initialFocus,
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
}) {
  // 여러 위젯 동시 expand 가능 — Set 으로 관리. 초기엔 affordance 위해
  // 1장만 열림 (focus param 또는 첫 widget). 그 후엔 사용자가 자유롭게
  // expand/collapse — 다른 카드 클릭해도 기존 열려있던 카드 닫히지 X.
  const initial =
    initialFocus && widgets.some((w) => w.key === initialFocus)
      ? initialFocus
      : (widgets[0]?.key ?? null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    initial ? new Set([initial]) : new Set(),
  );

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // widgets 를 row 별로 chunked. flex row layout 의 기본 단위.
  const totalRows = Math.ceil(widgets.length / GRID_COLS);
  const rows = useMemo(() => {
    const out: { row: number; items: { w: WidgetContent; idx: number }[] }[] = [];
    for (let r = 0; r < totalRows; r += 1) {
      const items: { w: WidgetContent; idx: number }[] = [];
      for (let c = 0; c < GRID_COLS; c += 1) {
        const idx = r * GRID_COLS + c;
        if (idx < widgets.length) items.push({ w: widgets[idx], idx });
      }
      out.push({ row: r, items });
    }
    return out;
  }, [widgets, totalRows]);

  // 카드 클릭 시 expandedKeys 에 추가. 이전 expanded 카드 없을 때만 pan-to
  // -widget — 다른 카드 이미 열려있으면 flex 가 동적으로 layout 재계산하니
  // static 좌표 기반 pan 은 부정확. 사용자가 직접 pan / wheel 로 navigate.
  const expandTo = useCallback(
    (key: string) => {
      const idx = widgets.findIndex((w) => w.key === key);
      if (idx !== -1 && expandedKeys.size === 0) {
        // 첫 expand — 카드 collapsed 위치 기준 pan-to-center. row 별
        // 가운데 정렬 가정 (flex justify-center).
        const col = idx % GRID_COLS;
        const row = Math.floor(idx / GRID_COLS);
        const rowWidth = GRID_COLS * CARD_W_COLLAPSED + (GRID_COLS - 1) * CELL_GAP;
        const colCenter = col * PITCH + CARD_W_COLLAPSED / 2 - rowWidth / 2;
        const totalH =
          totalRows * CARD_W_COLLAPSED + Math.max(0, totalRows - 1) * CELL_GAP;
        const rowCenter = row * PITCH + CARD_W_COLLAPSED / 2 - totalH / 2;
        setPan({
          x: -colCenter * zoom,
          y: -rowCenter * zoom,
        });
      }
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- widgets 정적
    [zoom, totalRows, expandedKeys.size],
  );

  // 개별 위젯 collapse — 다른 expanded 위젯엔 영향 X. pan 도 그대로 (사용자
  // 시야 유지).
  const collapseKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    // wheel = zoom (Miro-식). Ctrl/Cmd 가드 없이도 작동 — 캔버스가 viewport
    // 점유하므로 페이지 스크롤은 어차피 없음.
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    setZoom((z) => {
      const next = z + direction * ZOOM_STEP;
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });
  }, []);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // 카드 위 드래그는 pan 안 함 (카드 클릭 / 본문 인터랙션 우선)
      if ((e.target as HTMLElement).closest('[data-canvas-card]')) return;
      dragRef.current = {
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
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsPanning(false);
  }, []);

  return (
    <div
      className="relative h-[calc(100vh-3rem)] overflow-hidden bg-paper"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
    >
      {/* dot grid 배경 — pan 시 함께 이동해야 표면 이동 감각이 살아남.
          background-position 을 pan offset 에 동기화. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(29,27,32,0.06) 1px, transparent 1px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="flex flex-col items-center"
          style={{
            // flex row layout — 같은 row 의 카드들이 expand 시 우측 카드를
            // push (overlap X). row 사이엔 영향 X — items-start 로 row 상단
            // 정렬, expanded 카드가 길어도 같은 row 의 collapsed 카드는
            // 위쪽에 머무름.
            gap: `${CELL_GAP}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
          }}
        >
          {rows.map(({ row, items }) => (
            <div
              key={row}
              className="flex items-start"
              style={{ gap: `${CELL_GAP}px` }}
            >
              {items.map(({ w }) => {
                const isExpanded = expandedKeys.has(w.key);
                return (
                  <div
                    key={w.key}
                    data-canvas-card
                    style={{
                      // 카드 wrapper — collapsed = 240, expanded = 480.
                      // minHeight = 240 으로 collapsed 정사각형 유지, expanded
                      // 는 본문 자연 높이로 자라남.
                      width: isExpanded
                        ? CARD_W_EXPANDED
                        : CARD_W_COLLAPSED,
                      minHeight: CARD_W_COLLAPSED,
                      transition: 'width 0.3s ease-out',
                    }}
                  >
                    <WidgetShell
                      content={w}
                      expanded={isExpanded}
                      onExpand={() => expandTo(w.key)}
                      onCollapse={() => collapseKey(w.key)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
