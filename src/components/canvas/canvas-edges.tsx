'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasEdges — n8n 스타일 SVG bezier 연결선 오버레이.

   - 위젯 좌표 (positions) + 크기 (sizes) 와 EDGES SSOT 를 받아 각 edge 의
     출발점 (from 위젯 right-middle port) → 도착점 (to 위젯 left-middle port)
     사이 horizontal-bias cubic bezier 를 그림.
   - 위젯이 collapsed 면 height 가 작아 port y 도 자동 조정.
   - kind='live' 는 dashed + stroke-dashoffset 애니메이션 (CSS keyframe).
   - SVG 는 캔버스 surface 와 동일 transform 을 받아 pan/zoom 자동 정합.
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

// horizontal-bias cubic bezier — control point 가 출발/도착점 사이 가로
// 거리의 절반만큼 right/left 로 뻗어나가 부드러운 S 또는 직선 곡선.
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
      style={{ overflow: 'visible' }}
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
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-mute-soft)" />
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
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-amore)" />
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
              stroke={live ? 'var(--color-amore)' : 'var(--color-mute-soft)'}
              strokeWidth={live ? 2 : 1.5}
              strokeDasharray={live ? '6 6' : undefined}
              markerEnd={`url(#${live ? 'canvas-edge-arrow-live' : 'canvas-edge-arrow'})`}
              className={live ? 'canvas-edge-live' : undefined}
              opacity={0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}
