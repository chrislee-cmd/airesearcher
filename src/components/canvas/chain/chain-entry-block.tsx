'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainEntryBlock — 체인 생성 진입점 (fresh 프레젠테이션).

   CD SSOT: `widget-chain.dc.html` C1 (E1/E2/E3) + `BUILD-SPEC.md` §1.5.
   위치 = 프로빙 셋업 본문 하단(접힌 아코디언 아래).

   **기본은 꺼짐**(E1)이고 켜면 기본 모드는 단계별 승인(사용자 결정 ①). 프로빙 25
   는 세션 시작 시 이미 차감되므로 미리보기 1행은 "시작 시 차감" 으로 따로 표시하고
   합계에서 뺀다. 인제스트 비용은 파일 수가 세션 뒤에 정해지므로 "파일당 N" 으로만
   쓴다 — 금액을 추정해 넣지 않는다(C1 note). 탑라인은 cost 0 → "포함".

   경계: 프레젠테이션 + 콜백만. 체인 생성 POST 는 컨테이너(프로빙 카드)가 CTA
   시점에 수행한다 — 이 블록은 "무엇을 켰는지" 만 말한다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { CHAIN_STEP_TONE, type ChainPreviewRow } from '@/lib/chains/view';

const TONE_DOT: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

export type ChainEntryBlockProps = {
  /** 체인 생성 여부(토글). 기본 false. */
  enabled: boolean;
  mode: 'approve' | 'auto';
  onToggle: (next: boolean) => void;
  onModeChange: (mode: 'approve' | 'auto') => void;
  /** 진입점 기준 남은 단계(진입 단계 포함) — `chainPreviewRows()` 산출. */
  preview: ChainPreviewRow[];
  /** 세션 진행 중 등 변경 불가 상황. */
  disabled?: boolean;
};

export function ChainEntryBlock({
  enabled,
  mode,
  onToggle,
  onModeChange,
  preview,
  disabled = false,
}: ChainEntryBlockProps) {
  const t = useTranslations('Chain');

  const costText = (cost: number) =>
    cost === 0 ? t('costIncluded') : t('cost', { cost });

  // 합계 — 진입 단계(이미 차감)와 cost 0(포함) 은 빼고, 파일 수에 비례하는
  // 인제스트는 금액이 아니라 "파일당 N" 으로 분리한다(추정 금지).
  const perFileRow = preview.find(
    (r) => !r.entryStep && r.feature === 'interview_ingest' && r.cost > 0,
  );
  const fixedTotal = preview
    .filter(
      (r) => !r.entryStep && r.feature !== 'interview_ingest' && r.cost > 0,
    )
    .reduce((sum, r) => sum + r.cost, 0);
  const totalValue = perFileRow
    ? t('entry.totalFixedPerFile', {
        fixed: fixedTotal,
        perFile: perFileRow.cost,
      })
    : t('entry.totalFixed', { fixed: fixedTotal });

  return (
    <div
      data-chain="entry"
      data-chain-entry-on={enabled ? 'true' : 'false'}
      data-chain-entry-mode={mode}
      className={`overflow-hidden rounded-panel bg-paper ${
        enabled
          ? 'border-2 border-ink shadow-memphis-md-faint'
          : 'border-[1.5px] border-ink/[0.16]'
      }`}
    >
      {/* 헤더 행 — 타일 + 제목/부제 + 토글 */}
      <div className="flex items-center gap-[11px] px-[15px] py-[13px]">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-icon border-[1.5px] border-ink bg-paper">
          <DuotoneIcon name="link" size={17} />
        </div>
        <div className="min-w-0 flex-1">
          {/* CD 14/800. DS 램프상 14 → text-xl(15) 이지만 canvas 안에서는
              `.text-xl` 이 display 헤딩 훅([data-canvas-body] :is(…,.text-xl)
              = 26px/800)이라 제목이 2배로 부푼다 — 한 스텝 아래 text-lg(13)로
              내린다(이웃 셋업 아코디언 행이 text-sm 이라 위계도 유지). */}
          <div className="text-lg font-extrabold leading-4 text-ink">
            {t('entry.title')}
          </div>
          <div className="mt-0.5 text-md leading-[1.55] text-mute">
            {t('entry.subtitle')}
          </div>
        </div>
        {/* 토글 42×24 — off = disabled 트랙 / on = ink 트랙 + rose 노브 */}
        {/* eslint-disable-next-line react/forbid-elements -- CD §1.5 토글 42×24(ink 트랙 + rose 노브)은 스위치 chrome 이다. 레포에 Switch primitive 가 없고 Button variant 로는 표현 불가 — 별도 primitive 는 별 PR(§3.2). */}
        <button
          type="button"
          // data-canvas-action — [data-canvas-body] button:not([data-canvas-action])
          // 이 memphis 보더/radius/padding/shadow 를 씌워 스위치 chrome 을 덮는다.
          data-canvas-action
          role="switch"
          aria-checked={enabled}
          aria-label={t('entry.title')}
          disabled={disabled}
          onClick={() => onToggle(!enabled)}
          className={`flex h-6 w-[42px] shrink-0 items-center rounded-pill border-[1.5px] border-ink p-0.5 transition-colors disabled:opacity-40 ${
            enabled
              ? 'justify-end bg-ink'
              : 'justify-start bg-surface-disabled'
          }`}
        >
          <span
            className={`h-[17px] w-[17px] rounded-full border-[1.5px] border-ink ${
              enabled ? 'bg-rose' : 'bg-paper'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="flex flex-col gap-3 border-t-[1.5px] border-ink/[0.12] px-[15px] py-[13px]">
          {/* 모드 세그먼트 (SSOT §D3 세그먼트) */}
          <div
            role="radiogroup"
            aria-label={t('entry.modeGroup')}
            className="inline-flex self-start overflow-hidden rounded-control border-[1.5px] border-ink bg-paper shadow-memphis-sm"
          >
            <ModeCell
              selected={mode === 'approve'}
              onClick={() => onModeChange('approve')}
              disabled={disabled}
            >
              {t('mode.approve')}
            </ModeCell>
            <span aria-hidden className="w-[1.5px] bg-ink" />
            <ModeCell
              selected={mode === 'auto'}
              onClick={() => onModeChange('auto')}
              disabled={disabled}
            >
              {t('mode.auto')}
            </ModeCell>
          </div>

          <div className="text-md leading-[1.65] text-mute">
            {t(mode === 'auto' ? 'entry.noteAuto' : 'entry.noteApprove')}
          </div>

          {/* 미리보기 — 남은 단계 + 단계별 비용 + 합계 */}
          <div className="overflow-hidden rounded-control border-[1.5px] border-ink/[0.14]">
            {preview.map((rowItem, i) => (
              <div
                key={rowItem.feature}
                className={`flex items-center gap-2.5 border-b border-ink/[0.07] px-3 py-2 ${
                  // 1행(진입 단계) = 이미 결정된 단계 → canvas 음영
                  rowItem.entryStep ? 'bg-surface-canvas' : 'bg-paper'
                }`}
              >
                <span className="w-[14px] font-mono text-xs font-extrabold text-mute-soft">
                  {i + 1}
                </span>
                <span
                  aria-hidden
                  className={`h-3 w-3 shrink-0 rounded-full border-[1.5px] border-ink ${TONE_DOT[CHAIN_STEP_TONE[rowItem.feature]]}`}
                />
                <span className="flex-1 text-md font-bold text-ink">
                  {t(`steps.${rowItem.feature}`)}
                </span>
                <span className="text-sm text-mute-soft">
                  {/* 진입 단계는 체인 시작 전 이미 차감 — 단계 종류와 무관하게
                      같은 문구("시작 시 차감"). */}
                  {rowItem.entryStep
                    ? t('entry.note.entry')
                    : t(`entry.note.${rowItem.feature}`)}
                </span>
                <span className="w-16 text-right font-mono text-md font-extrabold text-ink">
                  {costText(rowItem.cost)}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 border-t-[1.5px] border-ink/[0.12] bg-paper-soft px-3 py-[9px]">
              <span className="flex-1 text-md font-extrabold text-ink">
                {t('entry.totalLabel')}
              </span>
              <span className="font-mono text-md font-extrabold text-ink">
                {totalValue}
              </span>
            </div>
          </div>

          {mode === 'auto' && (
            <div className="flex items-start gap-[9px] rounded-control border-[1.5px] border-amber-line bg-warning-bg px-3 py-2.5">
              <span
                aria-hidden
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber"
              />
              <span className="text-md leading-[1.6] text-amber-text">
                {t('entry.autoWarning')}
              </span>
            </div>
          )}
        </div>
      )}
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
    // eslint-disable-next-line react/forbid-elements -- CD §1.5 모드 세그먼트 셀(SSOT §D3)은 보더/radius/shadow 를 부모 트랙이 소유하는 bare 셀이다. Button primitive 는 셀마다 자기 chrome 을 그려 세그먼트가 성립하지 않는다 — picker-trigger 의 grouped 셀과 같은 구조.
    <button
      type="button"
      // data-canvas-action — 세그먼트 셀은 트랙이 chrome 을 소유한다. opt-out 이
      // 없으면 canvas cascade 가 셀마다 memphis 박스를 그려 세그먼트가 깨진다.
      data-canvas-action
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`px-[15px] py-[7px] text-md font-extrabold transition-colors disabled:opacity-40 ${
        selected ? 'bg-ink text-paper' : 'bg-paper text-mute hover:bg-paper-soft'
      }`}
    >
      {children}
    </button>
  );
}
