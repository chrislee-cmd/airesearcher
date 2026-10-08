'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainEntryPopover — 출력 포트에서 여는 체인 생성 팝오버.
   CD SSOT: `v2/README.md` S0 · `widget-chain-v2.dc.html` popover.

   R4: v1 의 **위젯 안 토글 블록을 대체**한다. 드래그 생성(방향 ③)은 쓰지 않는다.
   기본 모드는 단계별 승인이고, 자동을 고르면 amber 경고가 추가된다(v1과 동일 문구).
   인제스트 비용은 파일 수가 세션 뒤에 정해지므로 "파일당 N" 으로만 쓴다 —
   금액을 추정해 넣지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  CHAIN_STEP_TONE,
  type ChainPreviewRow,
} from '@/lib/chains/view';

export const ENTRY_POPOVER_WIDTH = 372;

const TONE_DOT: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

export type ChainEntryPopoverProps = {
  mode: 'approve' | 'auto';
  onModeChange: (mode: 'approve' | 'auto') => void;
  /** 진입 단계를 **뺀** 남은 단계 (CD S0 표는 2·3·4 행만 보여준다). */
  preview: ChainPreviewRow[];
  onCancel: () => void;
  onConnect: () => void;
  busy?: boolean;
  /** surface 좌표(호스트가 핸들 기준으로 계산). */
  left: number;
  top: number;
};

export function ChainEntryPopover({
  mode,
  onModeChange,
  preview,
  onCancel,
  onConnect,
  busy = false,
  left,
  top,
}: ChainEntryPopoverProps) {
  const t = useTranslations('Chain');
  const costText = (cost: number) =>
    cost === 0 ? t('costIncluded') : t('cost', { cost });

  // 합계 — 파일 수에 비례하는 인제스트는 금액이 아니라 "파일당 N" 으로 분리.
  const perFileRow = preview.find(
    (r) => r.feature === 'interview_ingest' && r.cost > 0,
  );
  const fixedTotal = preview
    .filter((r) => r.feature !== 'interview_ingest' && r.cost > 0)
    .reduce((sum, r) => sum + r.cost, 0);
  const totalValue = perFileRow
    ? t('entry.totalFixedPerFile', {
        fixed: fixedTotal,
        perFile: perFileRow.cost,
      })
    : t('entry.totalFixed', { fixed: fixedTotal });

  return (
    <div
      data-chain="entry-popover"
      data-chain-entry-mode={mode}
      role="dialog"
      aria-label={t('entry.title')}
      style={{ left, top, width: ENTRY_POPOVER_WIDTH }}
      className="absolute overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-popover"
    >
      <div className="flex flex-col gap-[3px] px-[15px] pt-3 pb-1">
        <span className="text-xl font-extrabold text-ink">
          {t('entry.title')}
        </span>
        <span className="text-sm text-mute">{t('entry.subtitle')}</span>
      </div>

      <div className="px-[15px] py-2">
        <div
          role="radiogroup"
          aria-label={t('entry.modeGroup')}
          className="inline-flex overflow-hidden rounded-control border-[1.5px] border-ink bg-paper shadow-memphis-sm"
        >
          <ModeCell
            selected={mode === 'approve'}
            onClick={() => onModeChange('approve')}
            disabled={busy}
          >
            {t('mode.approve')}
          </ModeCell>
          <span aria-hidden className="w-[1.5px] bg-ink" />
          <ModeCell
            selected={mode === 'auto'}
            onClick={() => onModeChange('auto')}
            disabled={busy}
          >
            {t('mode.auto')}
          </ModeCell>
        </div>
      </div>

      <div className="mx-[15px] mt-0.5 overflow-hidden rounded-control border-[1.5px] border-ink/[0.14]">
        {preview.map((row) => (
          <div
            key={row.feature}
            className="flex items-center gap-[9px] border-b border-ink/[0.07] px-[11px] py-[7px]"
          >
            <span className="w-3 font-mono text-xs font-extrabold text-mute-soft">
              {row.index}
            </span>
            <span
              aria-hidden
              className={`h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-ink ${TONE_DOT[CHAIN_STEP_TONE[row.feature]]}`}
            />
            <span className="flex-1 text-md font-bold text-ink">
              {t(`steps.${row.feature}`)}
            </span>
            <span className="text-xs-soft text-mute-soft">
              {t(`entry.note.${row.feature}`)}
            </span>
            <span className="w-[52px] text-right font-mono text-sm font-extrabold text-ink">
              {costText(row.cost)}
            </span>
          </div>
        ))}
        <div className="flex items-center bg-paper-soft px-[11px] py-2">
          <span className="flex-1 text-sm font-extrabold text-ink">
            {t('entry.totalLabel')}
          </span>
          <span className="font-mono text-md font-extrabold text-ink">
            {totalValue}
          </span>
        </div>
      </div>

      {mode === 'auto' && (
        <div className="mx-[15px] mt-2 flex items-start gap-[9px] rounded-control border-[1.5px] border-amber-line bg-warning-bg px-3 py-2.5">
          <span
            aria-hidden
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber"
          />
          <span className="text-md leading-[1.6] text-amber-text">
            {t('entry.autoWarning')}
          </span>
        </div>
      )}

      <div className="mt-[11px] flex items-center gap-2.5 border-t-[1.5px] border-ink/[0.12] bg-surface-canvas px-[15px] py-[9px]">
        {/* eslint-disable-next-line react/forbid-elements -- CD 팝오버 푸터의 "취소" 는 패딩·보더·밑줄 없는 bare 텍스트(11.5/700 mute). 캡슐 "체인 종료" 와 동일 선례. */}
        <button
          type="button"
          data-chain-action="cancel-entry"
          onClick={onCancel}
          disabled={busy}
          className="text-sm font-bold text-mute transition-colors hover:text-ink disabled:opacity-40"
        >
          {t('entry.cancel')}
        </button>
        {/* eslint-disable-next-line react/forbid-elements -- CD 연결하기는 ink 채움 pill(radius-pill · pad 7/16 · shadow 2px2px0 ink/28). Button primitive 의 고정 radius/border 와 불일치(규칙 2c AUTHORITY). */}
        <button
          type="button"
          data-chain-action="connect"
          onClick={onConnect}
          disabled={busy}
          className="ml-auto inline-flex items-center rounded-pill bg-ink px-4 py-[7px] text-md font-extrabold text-paper shadow-memphis-sm-mid disabled:opacity-40"
        >
          {t('entry.connect')}
        </button>
      </div>
    </div>
  );
}

function ModeCell({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- 세그먼트 셀은 트랙이 chrome 을 소유하는 bare 셀이다. Button primitive 는 셀마다 자기 chrome 을 그려 세그먼트가 성립하지 않는다(picker-trigger 의 grouped 셀과 같은 구조).
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`px-[14px] py-1.5 text-md font-extrabold transition-colors disabled:opacity-40 ${
        selected ? 'bg-ink text-paper' : 'bg-paper text-mute hover:bg-paper-soft'
      }`}
    >
      {children}
    </button>
  );
}
