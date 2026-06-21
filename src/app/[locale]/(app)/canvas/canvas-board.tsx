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
// 절대 좌표 layout — 카드가 (col, row) 위치에 고정. CSS grid auto-flow
// 시 expanded col-span-2 가 자동 reshuffle 되어 "center merge" 현상이
// 생겼던 게 root cause. position: absolute 로 각 카드가 자기 슬롯 유지.
const CARD_W_COLLAPSED = 240;
const CARD_W_EXPANDED = 480; // 1.5 cells (PITCH 절반 정도 overlap 허용)
const CELL_GAP = 48;
const PITCH = CARD_W_COLLAPSED + CELL_GAP; // 288
const GRID_COLS = 3;
const GRID_W = GRID_COLS * CARD_W_COLLAPSED + (GRID_COLS - 1) * CELL_GAP; // 816

// 카드 i 의 좌상단 (절대 좌표, 그리드 surface 내부 기준).
function cardPosition(idx: number): { left: number; top: number } {
  const col = idx % GRID_COLS;
  const row = Math.floor(idx / GRID_COLS);
  return {
    left: col * PITCH,
    top: row * PITCH,
  };
}

// 카드 i 의 collapsed 중심 (그리드 surface 중심 기준 offset). pan-to-center
// 계산용. grid_W/2 = 408, grid_H/2 = 264 (2 rows).
function cardCenterOffset(
  idx: number,
  totalRows: number,
): { x: number; y: number } {
  const gridH =
    totalRows * CARD_W_COLLAPSED + Math.max(0, totalRows - 1) * CELL_GAP;
  const pos = cardPosition(idx);
  return {
    x: pos.left + CARD_W_COLLAPSED / 2 - GRID_W / 2,
    y: pos.top + CARD_W_COLLAPSED / 2 - gridH / 2,
  };
}

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

  const totalRows = Math.ceil(widgets.length / GRID_COLS);

  // 카드 클릭 시 expandedKeys 에 추가 + 그 카드 중심으로 부드럽게 pan
  // (graceful zoom-into-widget). 기존 expanded 카드들은 그대로.
  const expandTo = useCallback(
    (key: string) => {
      const idx = widgets.findIndex((w) => w.key === key);
      if (idx !== -1) {
        const offset = cardCenterOffset(idx, totalRows);
        setPan({
          x: -offset.x * zoom,
          y: -offset.y * zoom,
        });
      }
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- widgets 정적
    [zoom, totalRows],
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
          className="relative"
          style={{
            // 절대 좌표 surface — CSS grid auto-flow 의 reshuffle 문제 회피.
            // 각 카드는 cardPosition(idx) 의 (left, top) 에 고정. expanded
            // 시에도 위치 변경 X (width / height 만 성장). 여러 expanded
            // 동시 가능 — z-10 으로 겹침 처리.
            width: `${GRID_W}px`,
            height: `${totalRows * CARD_W_COLLAPSED + Math.max(0, totalRows - 1) * CELL_GAP}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            // pan 중엔 transition 없음 (드래그가 부드럽게 따라옴). 그 외엔
            // 0.28s ease-out — 카드 클릭 시 카메라가 그쪽으로 부드럽게 이동.
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
          }}
        >
          {widgets.map((w, idx) => {
            const isExpanded = expandedKeys.has(w.key);
            const pos = cardPosition(idx);
            return (
              <div
                key={w.key}
                data-canvas-card
                style={{
                  position: 'absolute',
                  left: pos.left,
                  top: pos.top,
                  width: isExpanded ? CARD_W_EXPANDED : CARD_W_COLLAPSED,
                  // 높이: collapsed 는 정사각형 강제 (CARD_W_COLLAPSED),
                  // expanded 는 자연 자람 (minHeight 만 보장).
                  minHeight: CARD_W_COLLAPSED,
                  zIndex: isExpanded ? 10 : 1,
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
      </div>
    </div>
  );
}
