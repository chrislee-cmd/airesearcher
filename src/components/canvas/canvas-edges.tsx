'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasEdges — n8n 스타일 SVG bezier 연결선 오버레이.

   - 위젯 좌표 (boxes) + EDGES SSOT 로 각 edge 의 출발점 (from 오른쪽 port)
     → 도착점 (to 왼쪽 port) 사이 horizontal-bias cubic bezier.
   - 위젯이 collapsed 면 height 가 작아 port y 도 자동 조정.
   - kind='live' 는 dashed + stroke-dashoffset 애니메이션 (CSS keyframe).
   - SVG 는 surface 와 동일 transform 을 받아 pan/zoom 자동 정합.
   - theme: --canvas-edge / --canvas-edge-live / --canvas-edge-filter
     CSS variables. data-canvas-theme 컨테이너 안에서 override.
   - pointer-events: none — edge 가 위젯 클릭 방해 X.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import { EDGES, type Edge } from '@/lib/canvas/graph';
import type { CanvasWidgetKey } from '@/lib/canvas/visibility';

type Box = { x: number; y: number; w: number; h: number };

function portOut(b: Box): { x: number; y: number } {
  return { x: b.x + b.w, y: b.y + b.h / 2 };
}
function portIn(b: Box): { x: number; y: number } {
  return { x: b.x, y: b.y + b.h / 2 };
}

function bezierPath(from: Box, to: Box): string {
  const a = portOut(from);
  const b = portIn(to);
  const dx = Math.max(80, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function CanvasEdges({
  boxes,
  surfaceW,
  surfaceH,
  visibleKeys,
}: {
  boxes: Record<string, Box>;
  surfaceW: number;
  surfaceH: number;
  visibleKeys: Set<CanvasWidgetKey>;
}) {
  const active: Edge[] = useMemo(
    () =>
      EDGES.filter(
        (e) =>
          visibleKeys.has(e.from) &&
          visibleKeys.has(e.to) &&
          boxes[e.from] &&
          boxes[e.to],
      ),
    [boxes, visibleKeys],
  );

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={surfaceW}
      height={surfaceH}
      viewBox={`0 0 ${surfaceW} ${surfaceH}`}
      style={{ overflow: 'visible', filter: 'var(--canvas-edge-filter)' }}
    >
      <defs>
        <marker
          id="canvas-edge-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-edge)" />
        </marker>
        <marker
          id="canvas-edge-arrow-live"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--canvas-edge-live)" />
        </marker>
      </defs>
      {active.map((e) => {
        const d = bezierPath(boxes[e.from], boxes[e.to]);
        const live = e.kind === 'live';
        return (
          <g key={`${e.from}-${e.to}`}>
            <path
              d={d}
              fill="none"
              stroke={live ? 'var(--canvas-edge-live)' : 'var(--canvas-edge)'}
              strokeWidth={live ? 'var(--canvas-edge-live-width)' : 'var(--canvas-edge-width)'}
              strokeDasharray={live ? '6 6' : undefined}
              markerEnd={`url(#${live ? 'canvas-edge-arrow-live' : 'canvas-edge-arrow'})`}
              className={live ? 'canvas-edge-live' : undefined}
              style={{ opacity: 'var(--canvas-edge-opacity)' as unknown as number }}
            />
          </g>
        );
      })}
    </svg>
  );
}
