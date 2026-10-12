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

   ── Soft 값 (캔버스 모듈화 Phase 1 · full §5 "수용/거절 외형") ──────────────
   "v3 L1 / L2 / L2b 문법 그대로, 바탕만 Soft 값(수용 = 들어올 위젯 **틴트** +
   1.5 dashed ink, 거절 = `--err-bg` + 1.5 dashed `--err-dot`)".
   수용 바탕이 원색이 아니라 **틴트**인 것이 핵심이다 — Soft 핵심규칙 3
   ("원색은 아이콘 타일·상태 점 같은 작은 면에만"). 그리고 수용 테두리가
   실선 → **점선**으로 바뀐다(아직 비어 있는 자리라는 뜻을 선이 말한다).
   선 두께·치수는 제약 1 대로 유지하고 색/스타일만 Soft 로 맞춘다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  CHAIN_STEP_TONE,
  type ChainStepFeature,
} from '@/lib/chains/view';

/** 레인 안 카드/슬롯 실치수 (CD 결정 1 — 축소하지 않는다). */
export const LANE_CARD_W = 604;
export const LANE_CARD_H = 900;

// 수용 슬롯 바탕 = 들어올 위젯의 **틴트**(넓은 면). 원색(--tone-*)은 쓰지 않는다.
const TONE_TINT: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-tint-sky',
  lav: 'bg-tint-lav',
  rose: 'bg-tint-rose',
};

// 칩의 상태 점 — 작은 면이라 원색. `--tone-*` 는 기존 파스텔과 값이 1:1 이라
// 신규 util 이 없다(globals.css Soft 블록 주석의 매핑표).
const TONE_DOT: Record<'sky' | 'lav' | 'rose', string> = {
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
      ? `border-[3px] border-dashed border-ink ${toneFeature ? TONE_TINT[CHAIN_STEP_TONE[toneFeature]] : 'bg-soft-surface'}`
      : state === 'invalid'
        ? 'border-[3px] border-dashed border-soft-err-dot bg-soft-err-bg'
        : 'border-[2.5px] border-dashed border-soft-line-hover bg-soft-surface-2';

  const tile =
    state === 'valid'
      ? 'border-[2.5px] border-ink bg-soft-surface text-ink'
      : state === 'invalid'
        ? 'border-[2.5px] border-soft-err-dot bg-soft-surface text-soft-err-fg'
        : 'border-[2.5px] border-dashed border-soft-line-hover bg-soft-surface text-soft-faint';

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
        className={`px-10 text-center text-3xl font-bold ${
          state === 'invalid' ? 'text-soft-err-fg' : 'text-ink'
        }`}
      >
        {heading}
      </div>
      <div
        className={`text-2xl ${state === 'valid' ? 'text-soft-ink-2' : 'text-soft-mute'}`}
      >
        {sub}
      </div>
      {chips.length > 0 && (
        <div className="flex items-center gap-2">
          {chips.map((f, i) => (
            <span key={f} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-2xl text-soft-faint">
                  →
                </span>
              )}
              <span
                className={`inline-flex items-center gap-2 rounded-pill bg-soft-fill px-4 py-2 text-2xl font-semibold text-soft-ink-2 ${
                  dimChips.includes(f) ? 'opacity-35' : ''
                }`}
              >
                {/* 상태 점은 **작은 면**이라 원색(--tone-*)을 쓴다(핵심규칙 3). */}
                <span
                  aria-hidden
                  className={`h-3 w-3 rounded-full ${TONE_DOT[CHAIN_STEP_TONE[f]]}`}
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
