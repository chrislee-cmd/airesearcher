'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainSlot — 레인의 빈 칸 / 드롭 피드백. CD SSOT: `v3/README.md` L0·L1·L2·L2b.

   카드와 같은 규격(604×900 · radius = 카드 프레임 토큰)이라, 드롭하면 그 자리에
   카드가 **그대로** 들어온다는 것이 형태로 읽힌다.

   상태 3종:
     · empty   — 점선 + "여기에 올 수 있는 위젯" 칩 (칩은 호환 그래프 파생)
     · valid   — 검정 실선 + 끌려오는 카드의 톤 채움
     · invalid — 붉은 점선 + 사유 + "넣을 수 있는 순서" 칩

   CD 결정 4: 받을 수 없는 드롭이어도 **드래그는 시작된다** — 시작부터 막으면
   왜 안 되는지 말할 자리가 없다. 거절은 여기서 사유와 함께 보여준다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  CHAIN_STEP_TONE,
  type ChainStepFeature,
} from '@/lib/chains/view';

/** 레인 안 카드/슬롯 실치수 (CD 결정 1 — 축소하지 않는다). */
export const LANE_CARD_W = 604;
export const LANE_CARD_H = 900;

const TONE_BG: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

export type ChainSlotState = 'empty' | 'valid' | 'invalid';

export type ChainSlotProps = {
  state: ChainSlotState;
  /** valid — 끌려오는 카드의 톤으로 채운다. */
  toneFeature?: ChainStepFeature | null;
  /** valid/invalid 제목. empty 는 고정 문구. */
  title?: string;
  /** empty: 받을 수 있는 단계 · invalid: 호환 순서 전체. */
  chips?: ChainStepFeature[];
  /** invalid 에서 흐리게 표시할 단계(해당 없음 표시). */
  dimChips?: ChainStepFeature[];
};

export function ChainSlot({
  state,
  toneFeature,
  title,
  chips = [],
  dimChips = [],
}: ChainSlotProps) {
  const t = useTranslations('Chain');

  const frame =
    state === 'valid'
      ? `border-[3px] border-ink ${toneFeature ? TONE_BG[CHAIN_STEP_TONE[toneFeature]] : 'bg-paper'}`
      : state === 'invalid'
        ? 'border-[3px] border-dashed border-error bg-error-bg'
        : 'border-[2.5px] border-dashed border-line-empty bg-surface-canvas';

  const tile =
    state === 'valid'
      ? 'border-[2.5px] border-ink text-ink'
      : state === 'invalid'
        ? 'border-[2.5px] border-error text-error-text'
        : 'border-[2.5px] border-dashed border-line-empty text-faint';

  const glyph = state === 'valid' ? '↓' : state === 'invalid' ? '✕' : '+';
  const heading =
    state === 'empty' ? t('lane.slotEmptyTitle') : (title ?? '');
  const sub =
    state === 'valid'
      ? t('lane.slotValidSub')
      : state === 'invalid'
        ? t('lane.slotInvalidSub')
        : t('lane.slotEmptySub');

  return (
    <div
      data-chain="slot"
      data-chain-slot={state}
      style={{
        width: LANE_CARD_W,
        height: LANE_CARD_H,
        borderRadius: 'var(--widget-card-frame-radius)',
      }}
      className={`flex shrink-0 flex-col items-center justify-center gap-5 ${frame}`}
    >
      <div
        className={`flex h-20 w-20 items-center justify-center rounded-full text-display font-extrabold ${tile}`}
      >
        <span aria-hidden>{glyph}</span>
      </div>
      <div
        className={`px-10 text-center text-3xl font-extrabold ${
          state === 'invalid' ? 'text-error-text' : 'text-ink'
        }`}
      >
        {heading}
      </div>
      <div
        className={`text-2xl ${state === 'valid' ? 'text-ink-2' : 'text-mute'}`}
      >
        {sub}
      </div>
      {chips.length > 0 && (
        <div className="flex items-center gap-2">
          {chips.map((f, i) => (
            <span key={f} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-2xl text-ink">
                  →
                </span>
              )}
              <span
                className={`inline-flex items-center gap-2 rounded-pill border-2 border-ink bg-paper px-4 py-2 text-2xl font-extrabold text-ink ${
                  dimChips.includes(f) ? 'opacity-35' : ''
                }`}
              >
                <span
                  aria-hidden
                  className={`h-3 w-3 rounded-full border-[1.5px] border-ink ${TONE_BG[CHAIN_STEP_TONE[f]]}`}
                />
                {t(`steps.${f}`)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
