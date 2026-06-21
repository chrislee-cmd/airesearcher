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
          className="grid grid-cols-3 gap-3"
          style={{
            width: '1116px',
            gridAutoRows: '360px',
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.18s ease-out',
          }}
        >
          {widgets.map((w) => {
            const isExpanded = expanded === w.key;
            return (
              <div
                key={w.key}
                data-canvas-card
                className={isExpanded ? 'col-span-2 row-span-2' : ''}
              >
                <WidgetShell
                  content={w}
                  expanded={isExpanded}
                  onExpand={() => setExpanded(w.key)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
