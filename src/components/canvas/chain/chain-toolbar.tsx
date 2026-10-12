'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainToolbar — 캔버스 좌상단 "+ 새 체인" + 요약 pill.
   CD SSOT: `v3/README.md` 결정 2·6 · Geometry(툴바).

   진입점은 **이 버튼 하나**다(결정 2) — 카드를 겹치면 자동 생성하는 방식은
   카드를 옮기다 실수로 체인이 생기고, 빈 공간 인터랙션은 발견하기 어렵다.
   파일럿은 레인 1개라 레인이 있으면 버튼이 잠기고 옆에 이유가 붙는다(결정 6).

   변환 레이어 **밖**에 마운트된다 — 캔버스를 pan/zoom 해도 화면에 남아야 하고,
   요약 pill 은 레인이 화면 밖일 때의 최소 신호이기 때문(LEARNINGS §3-1).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import type { ChainLaneStatusTone } from './chain-lane';

// 시그널 글자색 — 레인 헤더와 같은 Soft 원자를 쓴다(두 곳이 갈라지면 같은
// 체인의 상태가 툴바와 레인에서 다른 색으로 읽힌다).
const TONE_CLASS: Record<ChainLaneStatusTone, string> = {
  processing: 'text-soft-run-fg',
  amber: 'text-soft-warn-fg',
  error: 'text-soft-err-fg',
  success: 'text-soft-ok-fg',
  ink: 'text-ink',
  mute: 'text-soft-mute',
};

export type ChainToolbarProps = {
  /** 레인이 이미 있으면 잠긴다(파일럿 = 레인 1개). */
  locked: boolean;
  /**
   * 잠금은 아니지만 지금은 누를 수 없다 — 체인 첫 조회 중(레인이 복원될지
   * 모르는 구간). 사유 문구는 띄우지 않는다(곧 사라지는 상태라서).
   */
  busy?: boolean;
  onNewChain: () => void;
  /** 레인이 있을 때만 — 상태 요약. 누르면 레인으로 스크롤. */
  summary?: {
    mode: 'approve' | 'auto';
    text: string;
    tone: ChainLaneStatusTone;
    onFocusLane: () => void;
  } | null;
};

export function ChainToolbar({
  locked,
  busy = false,
  onNewChain,
  summary,
}: ChainToolbarProps) {
  const inert = locked || busy;
  const t = useTranslations('Chain');
  return (
    <div
      data-chain="toolbar"
      // 배치는 보드가 한다(캔버스 영역 기준 left 24 · top 20 — canvas-modular
      // §7). 옛 `left: 264` 는 좌상단의 **위젯 내비게이터**를 피하려던 값이고,
      // 그 패널이 이 PR 에서 퇴역했으므로 CD 좌표를 그대로 쓸 수 있게 됐다
      // (LEARNINGS §8-7 의 "그 자리에 이미 뭐가 있는지" 가 해소됨).
      className="pointer-events-none flex items-center gap-4"
    >
      {/* eslint-disable-next-line react/forbid-elements -- CD 툴바 pill 은 높이 56 · border 2 ink · 20/800 · shadow 3px3px0 ink 전용 chrome 이고 "잠김"(surface-disabled · faint · 그림자 없음) 상태를 가진다. Button primitive 의 고정 radius/size variant 와 불일치(§7.11). v2 캡슐 주 버튼과 동일 선례. */}
      <button
        type="button"
        data-chain-action="new-chain"
        data-chain-locked={inert ? 'true' : 'false'}
        disabled={inert}
        onClick={onNewChain}
        className={`pointer-events-auto inline-flex h-14 items-center rounded-pill px-6 text-3xl font-semibold ${
          inert
            ? 'bg-soft-fill text-soft-faint'
            : 'border border-soft-line bg-soft-surface text-ink shadow-soft-card hover:border-soft-line-hover'
        }`}
      >
        {t('toolbar.newChain')}
      </button>

      {locked && (
        <span data-chain-el="lock-reason" className="text-2xl text-soft-faint">
          {t('toolbar.newChainLocked')}
        </span>
      )}

      {summary && (
        // eslint-disable-next-line react/forbid-elements -- CD 요약 pill 은 높이 56 · border 2 ink · 38 원 타일을 품은 전용 chrome. Button primitive variant 와 형태 불일치(fullview-header 프로젝트 pill 과 동일 선례).
        <button
          type="button"
          data-chain="summary-pill"
          data-chain-mode={summary.mode}
          onClick={summary.onFocusLane}
          className="pointer-events-auto inline-flex h-14 items-center gap-3 rounded-pill border border-soft-line bg-soft-surface pr-6 pl-2 shadow-soft-card focus-visible:outline-none focus-visible:shadow-soft-focus-ring"
        >
          <span
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full ${
              summary.mode === 'auto' ? 'bg-ink' : 'bg-soft-fill'
            }`}
          >
            <DuotoneIcon name="link" size={20} mono={summary.mode === 'auto'} />
          </span>
          <span className="text-2xl font-bold text-ink">
            {t('lane.title')}
          </span>
          <span aria-hidden className="h-5 w-px bg-soft-line" />
          <span
            data-chain-el="status"
            className={`font-soft-mono text-2xl font-semibold ${TONE_CLASS[summary.tone]}`}
          >
            {summary.text}
          </span>
        </button>
      )}
    </div>
  );
}
