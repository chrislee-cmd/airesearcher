'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainSegment — 레인 안 카드 사이의 연결 구간. CD SSOT: `v3/README.md` Geometry.

   v2 의 엣지 상태 문법을 **그대로 승계**한다(값 SSOT = `v2/README.md`): 진행 =
   보라 흐름 · 대기 = amber 점선 · **멈춤 = 들어가는 구간 끊김** · **실패 =
   나가는 구간 끊김** · 완료 = 검정 실선. 바뀐 것은 경로뿐 — 카드가 레인 안에서
   인접하므로 v2 의 거터·다중 행 라우팅이 통째로 사라졌다.

   폭: 기본 96 → 캡슐이 들어가면 464(캡슐 400 + 좌우 32), 240ms ease-out.
   유령 상태 금지: paused/error 에는 보라·흐름이 하나도 없어야 한다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { ChainEdgeKind } from '@/lib/chains/view';
import { ChainCapsule, type ChainCapsuleProps } from './chain-capsule';
import { LANE_CARD_H } from './chain-slot';

export const SEGMENT_W = 96;
export const SEGMENT_W_OPEN = 464;
/** 선이 지나는 높이 = 카드 세로 중앙. */
const LINE_Y = LANE_CARD_H / 2;

export type ChainSegmentProps = {
  kind: ChainEdgeKind;
  /** running 라벨("{단계} 중"). 없으면 미표시. */
  label?: string | null;
  /** 들어가면 구간이 464 로 벌어진다. */
  capsule?: ChainCapsuleProps | null;
  reducedMotion?: boolean;
};

export function ChainSegment({
  kind,
  label,
  capsule,
  reducedMotion = false,
}: ChainSegmentProps) {
  const t = useTranslations('Chain');
  void t;
  const open = !!capsule;

  return (
    <div
      data-chain="segment"
      data-chain-segment={kind}
      data-chain-segment-open={open ? 'true' : 'false'}
      style={{
        width: open ? SEGMENT_W_OPEN : SEGMENT_W,
        height: LANE_CARD_H,
        // 벌어짐/줄어듦 240ms (reduced-motion 이면 즉시 전환).
        transition: reducedMotion ? undefined : 'width 240ms ease-out',
      }}
      className="relative flex shrink-0 items-center justify-center"
    >
      <SegmentLine kind={kind} reducedMotion={reducedMotion} />
      {label && (
        <span
          data-chain-el="run-label"
          style={{ top: LINE_Y - 34 }}
          className="absolute left-1/2 -translate-x-1/2 rounded-pill border-2 border-lav-line bg-lav-bg px-4 py-1.5 text-lg font-extrabold whitespace-nowrap text-lav-text"
        >
          {label}
        </span>
      )}
      {capsule && (
        <div className="relative z-10">
          <ChainCapsule {...capsule} />
        </div>
      )}
    </div>
  );
}

/**
 * 구간 선 — 끊김(paused/error)은 앞/뒤 반쪽을 따로 그리고, running 만 흐름
 * 애니메이션을 얹는다. 색은 전부 토큰 var().
 */
function SegmentLine({
  kind,
  reducedMotion,
}: {
  kind: ChainEdgeKind;
  reducedMotion: boolean;
}) {
  const broken = kind === 'paused' || kind === 'error';
  const headColor =
    kind === 'paused' ? 'var(--color-amber)' : 'var(--color-error)';
  const tipColor = broken
    ? 'var(--color-line-empty)'
    : kind === 'running'
      ? 'var(--color-processing)'
      : kind === 'awaiting'
        ? 'var(--color-amber)'
        : kind === 'done'
          ? 'var(--color-ink)'
          : 'var(--color-line-empty)';

  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0"
        style={{ top: LINE_Y - 3, height: 6 }}
      >
        {kind === 'running' ? (
          <span
            data-chain-el="flow"
            className={reducedMotion ? undefined : 'chain-lane-flow'}
            style={{
              position: 'absolute',
              left: 0,
              right: 11,
              top: 0,
              height: 5,
              borderRadius: 3,
              backgroundColor: 'var(--color-lav-line)',
              // reduced-motion 이면 흐름을 끄고 정적 보라 실선으로(README).
              backgroundImage: reducedMotion
                ? 'none'
                : 'repeating-linear-gradient(90deg, var(--color-processing) 0 16px, transparent 16px 44px)',
              ...(reducedMotion
                ? { backgroundColor: 'var(--color-processing)' }
                : null),
            }}
          />
        ) : broken ? (
          <span className="absolute inset-x-0 flex" style={{ top: 1 }}>
            <span
              className="flex-1"
              style={{ borderTop: `3px solid ${headColor}` }}
            />
            <span
              className="flex-1"
              style={{
                borderTop: '3px dashed var(--color-line-empty)',
              }}
            />
          </span>
        ) : (
          <span
            className="absolute"
            style={{
              left: 0,
              right: 11,
              top: 1,
              borderTop:
                kind === 'done'
                  ? '3px solid var(--color-ink)'
                  : kind === 'awaiting'
                    ? '3px dashed var(--color-amber)'
                    : '3px dashed var(--color-line-empty)',
            }}
          />
        )}
        {/* 화살촉 — 밑변 14 · 높이 11 */}
        <span
          className="absolute"
          style={{
            right: 0,
            top: -4,
            width: 0,
            height: 0,
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderLeft: `11px solid ${tipColor}`,
          }}
        />
      </span>
    </>
  );
}
