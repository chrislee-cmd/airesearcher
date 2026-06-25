'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasMinimap — n8n / Figma 풍 우상단 미니맵.

   - 캔버스 surface 전체를 200x140 면에 비례 축소.
   - 각 위젯 = 사각형, 현재 viewport = outline rect.
   - 클릭 = 그 지점을 viewport 중앙으로 jump.
   - theme: --canvas-chrome-* / --canvas-selection-border CSS variables.
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
  viewport: { x: number; y: number; w: number; h: number };
  onJumpTo: (surfaceX: number, surfaceY: number) => void;
}) {
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
      onJumpTo(localX / scale, localY / scale);
    },
    [scale, offsetX, offsetY, onJumpTo],
  );

  return (
    <div className="pointer-events-none absolute right-6 top-6 z-fab">
      <div
        className="pointer-events-auto relative overflow-hidden"
        style={{
          width: MINIMAP_W,
          height: MINIMAP_H,
          background: 'var(--canvas-chrome-bg)',
          border: '1px solid var(--canvas-chrome-border)',
          borderRadius: 'var(--canvas-chrome-radius)',
          boxShadow: 'var(--canvas-chrome-shadow)',
          backdropFilter: 'var(--canvas-backdrop)',
          WebkitBackdropFilter: 'var(--canvas-backdrop)' as unknown as string,
        }}
        onClick={onClick}
        role="img"
        aria-label="canvas minimap"
      >
        {/* surface 영역 — 옅게 칠해진 inset (현재 theme 의 canvas-bg) */}
        <div
          className="absolute"
          style={{
            left: offsetX,
            top: offsetY,
            width: contentW,
            height: contentH,
            background: 'var(--canvas-bg)',
            opacity: 0.55,
          }}
        />
        {/* 노드 사각형 */}
        {Object.entries(boxes).map(([key, b]) => (
          <div
            key={key}
            className="absolute rounded-[2px]"
            style={{
              left: offsetX + b.x * scale,
              top: offsetY + b.y * scale,
              width: Math.max(2, b.w * scale),
              height: Math.max(2, b.h * scale),
              background: 'var(--canvas-card-header-text)',
              opacity: 0.6,
            }}
          />
        ))}
        {/* viewport rect */}
        <div
          className="absolute rounded-[2px]"
          style={{
            left: offsetX + viewport.x * scale,
            top: offsetY + viewport.y * scale,
            width: Math.max(8, viewport.w * scale),
            height: Math.max(8, viewport.h * scale),
            border: '2px solid var(--canvas-selection-border)',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.4)',
          }}
        />
      </div>
    </div>
  );
}

export const MINIMAP_DIMENSIONS = { width: MINIMAP_W, height: MINIMAP_H };
