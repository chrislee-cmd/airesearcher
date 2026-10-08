'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainSummaryPill — 캔버스 좌상단 요약 pill. CD SSOT: `v2/README.md` R5 · S3b.

   v1 의 상단 체인 바를 줄인 것이다. 누르면 캔버스를 체인 쪽으로 이동시키고
   포커스 상태로 들어간다. **pill 에는 승인 버튼을 두지 않는다** — 결정은 캡슐에서만
   한다(R3). 캔버스를 pan 해도 화면에 남아야 하므로 변환 레이어 **밖**에 둔다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

export type ChainSummaryTone =
  | 'processing'
  | 'amber'
  | 'error'
  | 'success'
  | 'mute';

const TONE_CLASS: Record<ChainSummaryTone, string> = {
  processing: 'text-lav-text',
  amber: 'text-amber-text',
  error: 'text-error-text',
  success: 'text-success-text',
  mute: 'text-mute',
};

export type ChainSummaryPillProps = {
  mode: 'approve' | 'auto';
  statusText: string;
  tone: ChainSummaryTone;
  onFocusChain: () => void;
  onHoverChange: (hovered: boolean) => void;
};

export function ChainSummaryPill({
  mode,
  statusText,
  tone,
  onFocusChain,
  onHoverChange,
}: ChainSummaryPillProps) {
  const t = useTranslations('Chain');
  const auto = mode === 'auto';
  return (
    // eslint-disable-next-line react/forbid-elements -- CD R5 요약 pill 은 border 1.5 ink · radius-pill · shadow 2px2px0 ink/12 · 좌측 22px 타일을 품은 전용 chrome. Button primitive 의 고정 radius/padding variant 와 불일치(§7.11). fullview-header 프로젝트 pill 과 동일 선례.
    <button
      type="button"
      data-chain="summary-pill"
      data-chain-mode={mode}
      onClick={onFocusChain}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      className="inline-flex items-center gap-2 rounded-pill border-[1.5px] border-ink bg-paper py-[5px] pr-3 pl-1.5 shadow-memphis-sm-faint focus-visible:outline-none focus-visible:shadow-focus-ring"
    >
      <span
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] border-ink ${auto ? 'bg-ink' : 'bg-paper'}`}
      >
        <DuotoneIcon name="link" size={12} mono={auto} />
      </span>
      <span className="text-md font-extrabold text-ink">{t('label')}</span>
      <span className="text-xs-soft font-bold text-mute">
        {t(auto ? 'mode.auto' : 'mode.approve')}
      </span>
      <span aria-hidden className="h-[13px] w-[1.5px] bg-ink/[0.14]" />
      <span
        className={`font-mono text-sm font-extrabold ${TONE_CLASS[tone]}`}
        data-chain-el="status"
      >
        {statusText}
      </span>
    </button>
  );
}
