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
// Pan-to-center 계산용 셀 메트릭 — grid auto-flow 3-col, 1x1 collapsed
// 셀이 240×240, gap 24. 한 줄에 3장. 카드 index → 그리드 중심 기준 offset
// (px). 클릭 시 카드 중심이 viewport 중심에 오도록 pan 보정.
const CELL_SIZE = 240;
const CELL_GAP = 24;
const PITCH = CELL_SIZE + CELL_GAP; // 264
// 6 widget 그리드는 3 col × 2 row 가 default (collapsed 일 때).
// 카드 i의 grid 내부 중심 offset (그리드 중심 기준):
//   x = (col - 1) * PITCH  → col 0 = -264, col 1 = 0, col 2 = 264
//   y = (row - 0.5) * PITCH  → row 0 = -132, row 1 = 132
function cardCenterOffset(idx: number): { x: number; y: number } {
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  return {
    x: (col - 1) * PITCH,
    y: (row - 0.5) * PITCH,
  };
}

export function CanvasBoard({
  widgets,
  initialFocus,
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
}) {
  // 초기엔 affordance 위해 1장 열림 (focus param 또는 첫 widget). 사용자가
  // 접기 누르면 null 로 — 모든 widget collapsed 상태도 허용.
  const initial =
    initialFocus && widgets.some((w) => w.key === initialFocus)
      ? initialFocus
      : (widgets[0]?.key ?? null);
  const [expanded, setExpanded] = useState<string | null>(initial);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // 카드 클릭 시 그 카드 중심으로 부드럽게 pan (graceful zoom-into-widget
  // 효과). transform transition 이 0.28s ease-out 으로 보간.
  const expandTo = useCallback(
    (key: string) => {
      const idx = widgets.findIndex((w) => w.key === key);
      if (idx === -1) {
        setExpanded(key);
        return;
      }
      // Expanded 카드는 col-span-2 row-span-2 — 좌상단이 (col, row) 위치.
      // expanded 카드 중심 = 그 카드의 1×1 자리 + (PITCH/2, PITCH/2) 만큼
      // 우측·아래로 (2×2 가 좌상단 셀에서 시작).
      const offset = cardCenterOffset(idx);
      const expandedCenter = {
        x: offset.x + PITCH / 2,
        y: offset.y + PITCH / 2,
      };
      // pan = -expandedCenter * zoom (현재 zoom 반영). pan 적용 시 카드가
      // viewport 중앙에 오게 됨.
      setPan({
        x: -expandedCenter.x * zoom,
        y: -expandedCenter.y * zoom,
      });
      setExpanded(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- widgets 정적
    [zoom],
  );

  const collapseAll = useCallback(() => {
    setExpanded(null);
    // pan 은 그대로 — 사용자 시야 유지. 원위치 복귀를 원하면 사용자가 직접
    // pan / wheel 조정.
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
          className="grid grid-cols-3 gap-6"
          style={{
            // 3*240 + 2*24(gap-6) = 792. 카드를 compact tile 로 줄이고 위젯
            // 사이 여백을 넓혀 도구함 느낌 강조. expanded col-span-2 row-span-2
            // = 504×504 — 본문은 카드 안 overflow-y-auto 로 스크롤.
            width: '792px',
            gridAutoRows: '240px',
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            // pan 중엔 transition 없음 (드래그가 부드럽게 따라옴). 그 외엔
            // 0.28s ease-out — 카드 클릭 시 카메라가 그쪽으로 부드럽게 이동
            // 하는 graceful zoom-in 효과.
            transition: isPanning ? 'none' : 'transform 0.28s ease-out',
          }}
        >
          {widgets.map((w) => {
            const isExpanded = expanded === w.key;
            return (
              <div
                key={w.key}
                data-canvas-card
                className={
                  isExpanded
                    ? // col-span-2 만 — 높이는 자연 자람 (row-span 제거).
                      // self-start = 셀 위쪽 정렬 (stretch X), z-10 = 본문이
                      // 길어 다음 row 와 겹치면 위로 떠오름.
                      'z-10 col-span-2 self-start transition-all duration-300 ease-out'
                    : 'transition-all duration-300 ease-out'
                }
              >
                <WidgetShell
                  content={w}
                  expanded={isExpanded}
                  onExpand={() => expandTo(w.key)}
                  onCollapse={collapseAll}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
