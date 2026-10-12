'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainSegment — 레인 안 카드 사이의 연결 구간. CD SSOT: `v3/README.md` Geometry.

   v2 의 엣지 상태 문법을 **그대로 승계**한다(값 SSOT = `v2/README.md`): 진행 =
   보라 흐름 · 대기 = amber 점선 · **멈춤 = 들어가는 구간 끊김** · **실패 =
   나가는 구간 끊김** · 완료 = 검정 실선. 바뀐 것은 경로뿐 — 카드가 레인 안에서
   인접하므로 v2 의 거터·다중 행 라우팅이 통째로 사라졌다.

   폭: 기본 96 → 캡슐이 들어가면 464(캡슐 400 + 좌우 32), 240ms ease-out.
   유령 상태 금지: paused/error 에는 보라·흐름이 하나도 없어야 한다.

   Soft Identity (캔버스 모듈화 Phase 1): 선 색만 Soft 시그널 원자로 갈아탄다 —
   진행 `--run-dot` · 대기/멈춤 `--warn-dot` · 실패 `--err-dot` · 완료 `--ink` ·
   미정 `--line-hover`(= 1.5 dashed 빈 자리와 같은 값). 두께·경로는 불변(제약 1).
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
          className="absolute left-1/2 -translate-x-1/2 rounded-pill bg-soft-run-bg px-4 py-1.5 text-lg font-semibold whitespace-nowrap text-soft-run-fg"
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
  const headColor = kind === 'paused' ? 'var(--warn-dot)' : 'var(--err-dot)';
  const tipColor = broken
    ? 'var(--line-hover)'
    : kind === 'running'
      ? 'var(--run-dot)'
      : kind === 'awaiting'
        ? 'var(--warn-dot)'
        : kind === 'done'
          ? 'var(--ink)'
          : 'var(--line-hover)';

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
              backgroundColor: 'var(--run-track)',
              // reduced-motion 이면 흐름을 끄고 정적 보라 실선으로(README).
              backgroundImage: reducedMotion
                ? 'none'
                : 'repeating-linear-gradient(90deg, var(--run-dot) 0 16px, transparent 16px 44px)',
              ...(reducedMotion ? { backgroundColor: 'var(--run-dot)' } : null),
            }}
          />
        ) : broken ? (
          <span className="absolute inset-x-0 flex" style={{ top: 1 }}>
            <span
              className="flex-1"
              // 연결선 굵기 1.5px = CD 장면 01 지정값("완료 구간 1.5px ink 실선 ·
              // 진행 구간 1.5px --run-dot · 대기 구간 1.5px dashed"). 선 1px 규칙의
              // 대상인 '테두리'가 아니라 연결선 자체의 굵기다.
              style={{ borderTop: `1.5px solid ${headColor}` }}
            />
            <span
              className="flex-1"
              style={{ borderTop: '1.5px dashed var(--line-hover)' }}
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
                  ? '1.5px solid var(--ink)'
                  : kind === 'awaiting'
                    ? '1.5px dashed var(--warn-dot)'
                    : '1.5px dashed var(--line-hover)',
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
            // ⚠ 보더 스타일이 아니라 **CSS 삼각형 기하**다(width/height 0 +
            // 투명 보더로 화살촉을 만든다). Soft Identity "선은 전부 1px" 규칙의
            // 대상이 아니므로 줄이면 화살촉이 사라진다 — 선 스윕에서 제외.
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderLeft: `11px solid ${tipColor}`,
          }}
        />
      </span>
    </>
  );
}
