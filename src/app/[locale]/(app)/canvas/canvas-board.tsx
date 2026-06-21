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
// 셀이 240×240, gap 48 (도구함 breathing room). 카드 index → 그리드 중심
// 기준 offset (px). 클릭 시 카드 중심이 viewport 중심에 오도록 pan 보정.
const CELL_SIZE = 240;
const CELL_GAP = 48;
const PITCH = CELL_SIZE + CELL_GAP; // 288
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

  // 카드 클릭 시 expandedKeys 에 추가 + 그 카드 중심으로 부드럽게 pan
  // (graceful zoom-into-widget). 기존 expanded 카드들은 그대로.
  const expandTo = useCallback(
    (key: string) => {
      const idx = widgets.findIndex((w) => w.key === key);
      if (idx !== -1) {
        // expanded 카드는 col-span-2 — 좌상단이 (col, row), 중심은 그
        // 카드의 1×1 자리 + (PITCH/2, PITCH/2) 만큼 우측·아래.
        const offset = cardCenterOffset(idx);
        setPan({
          x: -(offset.x + PITCH / 2) * zoom,
          y: -(offset.y + PITCH / 2) * zoom,
        });
      }
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- widgets 정적
    [zoom],
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
          className="grid grid-cols-3 gap-12"
          style={{
            // 3*240 + 2*48(gap-12) = 816. 위젯 사이 여백을 더 넓혀 도구함
            // breathing room 확보. expanded col-span-2 = 528 폭, 높이는 자연
            // 자라남 (row-span 강제 X — self-start + z-10 으로 overflow OK).
            width: '816px',
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
            const isExpanded = expandedKeys.has(w.key);
            return (
              <div
                key={w.key}
                data-canvas-card
                className={
                  isExpanded
                    ? // col-span-2 만 — 높이는 자연 자람 (row-span 제거).
                      // self-start = 셀 위쪽 정렬 (stretch X), z-10 = 본문이
                      // 길어 다음 row 와 겹치면 위로 떠오름. 여러 expanded
                      // 카드가 공존 가능 — DOM 순서로 stacking 결정.
                      'z-10 col-span-2 self-start transition-all duration-300 ease-out'
                    : 'transition-all duration-300 ease-out'
                }
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
