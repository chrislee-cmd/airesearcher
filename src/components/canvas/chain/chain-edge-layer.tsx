'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainEdgeLayer — 엣지 SVG 오버레이. CD SSOT: `v2/README.md` R1·R2 · §Geometry.

   R2(상태는 엣지가 말한다): 진행 = 보라 흐름 · 대기 = amber 점선 ·
   **멈춤 = 들어가는 엣지 끊김 + Ⅱ** · **실패 = 나가는 엣지 끊김 + ✕** ·
   완료 = 검정 실선. 엣지 위치만 보고 "시작을 못 했다" 와 "하다가 실패했다" 를
   가른다 — 혼동 금지.

   유령 상태 금지: paused·error·cancelled 에는 보라·흐름 애니메이션이 하나도
   없어야 한다. 그래서 흐름 path 는 `running` 분기에서만 그린다.

   SVG 는 `pointer-events: none` 이고 카드와 **같은 transform 레이어** 안에 있다
   (줌/팬을 그대로 따라간다). 색은 토큰 var() 만 쓴다(raw hex 0).
   ──────────────────────────────────────────────────────────────────── */

import type { ChainEdgeKind } from '@/lib/chains/view';
import type { EdgeRoute } from './chain-geometry';

type Stroke = {
  color: string;
  width: number;
  dash?: string;
};

// CD ST 테이블 — 전부 토큰 참조.
const STROKE: Record<ChainEdgeKind, Stroke> = {
  done: { color: 'var(--color-ink)', width: 2.5 },
  running: { color: 'var(--color-processing)', width: 3, dash: '10 14' },
  awaiting: { color: 'var(--color-amber)', width: 2.5, dash: '7 6' },
  paused: { color: 'var(--color-amber)', width: 2.5 },
  error: { color: 'var(--color-error)', width: 2.5 },
  pending: { color: 'var(--color-line-empty)', width: 2, dash: '5 6' },
  ghost: {
    color: 'color-mix(in oklab, var(--color-ink) 32%, transparent)',
    width: 2,
    dash: '6 6',
  },
};
const RUN_BASE: Stroke = { color: 'var(--color-lav-line)', width: 3 };

export type ChainEdgeRender = {
  kind: ChainEdgeKind;
  route: EdgeRoute;
};

export function ChainEdgeLayer({
  edges,
  width,
  height,
  reducedMotion,
}: {
  edges: ChainEdgeRender[];
  width: number;
  height: number;
  /** 흐름 애니메이션을 끄고 정적 보라 실선으로 그린다. */
  reducedMotion: boolean;
}) {
  return (
    <svg
      data-chain="edges"
      width={width}
      height={height}
      // 레인은 카드 top 보다 위(음수 y)에 있을 수 있다 — viewBox 를 위로 늘려
      // 잘리지 않게 한다.
      viewBox={`0 ${-OVERHANG} ${width} ${height + OVERHANG}`}
      style={{
        position: 'absolute',
        left: 0,
        top: -OVERHANG,
        width,
        height: height + OVERHANG,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden
    >
      {edges.map(({ kind, route }, i) => (
        <g key={i} data-chain-edge={kind}>
          {kind === 'running' ? (
            <>
              {/* 바탕 + 흐름 2겹. reduced-motion 이면 흐름을 정적 실선으로. */}
              <Path d={route.path} s={RUN_BASE} />
              <Path
                d={route.path}
                s={
                  reducedMotion
                    ? { ...STROKE.running, dash: undefined }
                    : STROKE.running
                }
                className={reducedMotion ? undefined : 'chain-edge-flow'}
              />
              <Arrow points={route.arrow} color={STROKE.running.color} />
            </>
          ) : kind === 'paused' || kind === 'error' ? (
            <>
              {/* 끊긴 엣지 — 앞쪽 반만 상태색, 뒤쪽 반과 화살촉은 pending. */}
              <Path d={route.brokenStart} s={STROKE[kind]} />
              <Path d={route.brokenEnd} s={STROKE.pending} />
              <Arrow points={route.arrow} color={STROKE.pending.color} />
            </>
          ) : (
            <>
              <Path d={route.path} s={STROKE[kind]} />
              <Arrow points={route.arrow} color={STROKE[kind].color} />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

// 레인이 카드 top 위 50px + 캡슐 높이까지 올라가므로 SVG 를 위로 넉넉히 늘린다.
const OVERHANG = 240;

function Path({
  d,
  s,
  className,
}: {
  d: string;
  s: Stroke;
  className?: string;
}) {
  return (
    <path
      d={d}
      className={className}
      fill="none"
      stroke={s.color}
      strokeWidth={s.width}
      strokeDasharray={s.dash}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Arrow({ points, color }: { points: string; color: string }) {
  return <polygon points={points} fill={color} />;
}
