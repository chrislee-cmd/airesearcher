'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasMinimap — n8n / Figma 풍 우상단 미니맵.

   - 캔버스 surface 전체를 200x140 면에 비례 축소.
   - 각 위젯 = grey rect, 현재 viewport = amore outline rect.
   - 미니맵 클릭 = 클릭 지점이 viewport 중앙이 되도록 pan 이동.
   - drag 도 동일 (현재 PR 은 클릭만 — drag 는 후속).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';

type Box = { x: number; y: number; w: number; h: number };

const MINIMAP_W = 200;
const MINIMAP_H = 140;

export function CanvasMinimap({
  boxes,
  surfaceW,
  surfaceH,
  viewport,
  onJumpTo,
}: {
  boxes: Record<string, Box>;
  surfaceW: number;
  surfaceH: number;
  // viewport: 현재 화면이 surface 좌표계에서 보고 있는 영역
  viewport: { x: number; y: number; w: number; h: number };
  // 사용자가 미니맵 위 (sx, sy) 를 클릭 → surface 좌표 (cx, cy) 가 화면 중앙이
  // 되도록 pan 조정 콜백.
  onJumpTo: (surfaceX: number, surfaceY: number) => void;
}) {
  // 비율 계산 — surface 가 minimap 보다 훨씬 크므로 scale 은 작은 값.
  const scale = useMemo(
    () => Math.min(MINIMAP_W / surfaceW, MINIMAP_H / surfaceH),
    [surfaceW, surfaceH],
  );
  const contentW = surfaceW * scale;
  const contentH = surfaceH * scale;
  const offsetX = (MINIMAP_W - contentW) / 2;
  const offsetY = (MINIMAP_H - contentH) / 2;

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left - offsetX;
      const localY = e.clientY - rect.top - offsetY;
      const surfaceX = localX / scale;
      const surfaceY = localY / scale;
      onJumpTo(surfaceX, surfaceY);
    },
    [scale, offsetX, offsetY, onJumpTo],
  );

  return (
    <div className="pointer-events-none absolute right-6 top-6 z-fab">
      <div
        className="pointer-events-auto relative overflow-hidden rounded-md border border-line bg-paper shadow-bento"
        style={{ width: MINIMAP_W, height: MINIMAP_H }}
        onClick={onClick}
        role="img"
        aria-label="canvas minimap"
      >
        {/* surface 영역 (옅은 fill) */}
        <div
          className="absolute bg-paper-soft"
          style={{ left: offsetX, top: offsetY, width: contentW, height: contentH }}
        />
        {/* 노드 사각형 */}
        {Object.entries(boxes).map(([key, b]) => (
          <div
            key={key}
            className="absolute rounded-[2px] bg-mute-soft"
            style={{
              left: offsetX + b.x * scale,
              top: offsetY + b.y * scale,
              width: Math.max(2, b.w * scale),
              height: Math.max(2, b.h * scale),
              opacity: 0.55,
            }}
          />
        ))}
        {/* viewport rect */}
        <div
          className="absolute rounded-[2px] border-2 border-amore"
          style={{
            left: offsetX + viewport.x * scale,
            top: offsetY + viewport.y * scale,
            width: Math.max(8, viewport.w * scale),
            height: Math.max(8, viewport.h * scale),
            boxShadow: '0 0 0 1px rgba(255,255,255,0.6)',
          }}
        />
      </div>
    </div>
  );
}

export const MINIMAP_DIMENSIONS = { width: MINIMAP_W, height: MINIMAP_H };
