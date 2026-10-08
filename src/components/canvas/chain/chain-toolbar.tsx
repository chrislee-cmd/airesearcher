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

const TONE_CLASS: Record<ChainLaneStatusTone, string> = {
  processing: 'text-lav-text',
  amber: 'text-amber-text',
  error: 'text-error-text',
  success: 'text-success-text',
  ink: 'text-ink',
  mute: 'text-mute',
};

export type ChainToolbarProps = {
  /** 레인이 이미 있으면 잠긴다(파일럿 = 레인 1개). */
  locked: boolean;
  onNewChain: () => void;
  /** 레인이 있을 때만 — 상태 요약. 누르면 레인으로 스크롤. */
  summary?: {
    mode: 'approve' | 'auto';
    text: string;
    tone: ChainLaneStatusTone;
    onFocusLane: () => void;
  } | null;
};

export function ChainToolbar({ locked, onNewChain, summary }: ChainToolbarProps) {
  const t = useTranslations('Chain');
  return (
    <div
      data-chain="toolbar"
      // left 는 캔버스 좌상단의 위젯 내비게이터(기본 x 24 · 폭 224)를 피한다 —
      // CD 는 툴바를 좌상단에 두지만 이 캔버스에는 이미 패널이 하나 있다
      // (프리뷰 실측: "+ 새 체인" 이 패널 뒤로 완전히 가려졌다). 내비게이터는
      // 사용자가 옮길 수 있으므로 기본 자리만 비켜 둔다.
      style={{ left: 264 }}
      className="pointer-events-none absolute top-8 z-overlay flex items-center gap-4"
    >
      {/* eslint-disable-next-line react/forbid-elements -- CD 툴바 pill 은 높이 56 · border 2 ink · 20/800 · shadow 3px3px0 ink 전용 chrome 이고 "잠김"(surface-disabled · faint · 그림자 없음) 상태를 가진다. Button primitive 의 고정 radius/size variant 와 불일치(§7.11). v2 캡슐 주 버튼과 동일 선례. */}
      <button
        type="button"
        data-chain-action="new-chain"
        data-chain-locked={locked ? 'true' : 'false'}
        disabled={locked}
        onClick={onNewChain}
        className={`pointer-events-auto inline-flex h-14 items-center rounded-pill px-6 text-3xl font-extrabold ${
          locked
            ? 'border-2 border-ink/[0.2] bg-surface-disabled text-mute-soft'
            : 'border-2 border-ink bg-paper text-ink shadow-memphis-md active:translate-x-px active:translate-y-px active:shadow-memphis-2xs'
        }`}
      >
        {t('toolbar.newChain')}
      </button>

      {locked && (
        <span data-chain-el="lock-reason" className="text-2xl text-mute">
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
          className="pointer-events-auto inline-flex h-14 items-center gap-3 rounded-pill border-2 border-ink bg-paper pr-6 pl-2 shadow-memphis-sm-faint focus-visible:outline-none focus-visible:shadow-focus-ring"
        >
          <span
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-ink ${
              summary.mode === 'auto' ? 'bg-ink' : 'bg-paper'
            }`}
          >
            <DuotoneIcon name="link" size={20} mono={summary.mode === 'auto'} />
          </span>
          <span className="text-2xl font-extrabold text-ink">
            {t('lane.title')}
          </span>
          <span aria-hidden className="h-5 w-0.5 bg-ink/[0.14]" />
          <span
            data-chain-el="status"
            className={`font-mono text-2xl font-extrabold ${TONE_CLASS[summary.tone]}`}
          >
            {summary.text}
          </span>
        </button>
      )}
    </div>
  );
}
