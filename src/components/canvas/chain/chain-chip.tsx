'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainChip — 체인에 묶인 카드의 서브바 우측 칩 (fresh 프레젠테이션).

   CD SSOT: `widget-chain.dc.html` C3 + `BUILD-SPEC.md` §1.4 · §3(칩 열).

   §0 Q2 결정: "연결됨" 의 시각 언어는 **바의 단계 트랙 + 이 칩** 이다. 카드끼리
   물리적으로 잇는 선은 비인접 카드 사이를 가로질러 다른 카드를 덮으므로 기각.
   트랙이 순서를, 칩이 "이 카드가 그 순서 몇 번째인지" 를 말한다.

   셸 경계: 칩은 `WidgetShell` 의 서브바 **슬롯**(subbarEnd)에 주입된다 —
   헤더·툴바 diff 0, 셸은 슬롯 1개만 추가됐다. 체인에 묶이지 않은 카드는
   컨테이너가 슬롯을 아예 넘기지 않아 서브바 자체가 렌더되지 않는다(칩 없음).

   유령 상태 금지: paused/error 칩은 "멈춤" 하나로 접히고 펄스가 없다(C3 note).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import type { ChainNodeStatus } from '@/lib/chains/view';

// 칩 상태 6종 (§3 칩 열). 노드 7종 중 paused·error 는 "멈춤" 하나로 접힌다.
export type ChainChipStatus =
  | 'running'
  | 'awaiting'
  | 'pending'
  | 'done'
  | 'stopped'
  | 'skipped';

/** 노드 상태 → 칩 상태. 멈춤/실패는 사용자가 구분할 행동이 없어 한 칸으로. */
export function chipStatusOf(status: ChainNodeStatus): ChainChipStatus {
  switch (status) {
    case 'paused':
    case 'error':
      return 'stopped';
    case 'awaiting':
      return 'awaiting';
    case 'running':
      return 'running';
    case 'done':
      return 'done';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}

// 색 = §3 칩 열. border/bg/text 세트로 묶어 토큰만 쓴다.
const CHIP_CLASS: Record<ChainChipStatus, string> = {
  running: 'border-lav-line bg-lav-bg text-lav-text',
  awaiting: 'border-amber-line bg-warning-bg text-amber-text',
  pending: 'border-ink/[0.2] bg-paper text-mute',
  done: 'border-success-line bg-success-bg text-success-text',
  // 멈춤 = amber 실선 + paper(틴트 없음) — 바의 paused 노드와 같은 문법.
  stopped: 'border-amber bg-paper text-amber-text',
  skipped: 'border-ink/[0.24] bg-surface-disabled text-mute',
};

export type ChainChipProps = {
  /** 이 카드가 맡은 단계의 1-기준 순번. */
  step: number;
  /**
   * 한 위젯이 연속 두 단계를 맡으면 끝 번호(CD S6: 인터뷰 분석 + 탑라인 =
   * "체인 3–4/4"). step 과 같거나 없으면 단일 번호로 표기한다.
   */
  stepTo?: number;
  /** 체인 전체 단계 수. */
  total: number;
  status: ChainChipStatus;
};

export function ChainChip({ step, stepTo, total, status }: ChainChipProps) {
  const t = useTranslations('Chain');
  const ranged = typeof stepTo === 'number' && stepTo !== step;

  // 라벨 3형태 (§3 · C3):
  //   pending            → "체인 4/4"            (상태 구절 없음 — 아직 차례 아님)
  //   stopped / skipped  → "체인 · 멈춤"          (순번 없음 — 체인이 여기서 섰다)
  //   그 외              → "체인 2/4 · 진행 중"
  const label =
    status === 'pending'
      ? t(ranged ? 'chip.withRange' : 'chip.withStep', {
          step,
          stepTo: stepTo ?? step,
          total,
        })
      : status === 'stopped' || status === 'skipped'
        ? t('chip.stateOnly', { state: t(`chip.state.${status}`) })
        : t(ranged ? 'chip.withRangeState' : 'chip.withStepState', {
            step,
            stepTo: stepTo ?? step,
            total,
            state: t(`chip.state.${status}`),
          });

  return (
    <span
      data-chain="chip"
      data-chain-chip={status}
      className={`inline-flex shrink-0 items-center gap-[5px] rounded-pill border-[1.5px] py-0.5 pl-[7px] pr-[9px] text-xs-soft font-extrabold ${CHIP_CLASS[status]}`}
    >
      <DuotoneIcon name="link" size={12} stroke="currentColor" />
      {label}
    </span>
  );
}
