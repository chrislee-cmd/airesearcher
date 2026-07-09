'use client';

import type { ReactNode } from 'react';

// Shared <ModeButton> / <ModeCardGroup> primitive — extracts the inline
// "리서치 목적" mode cards from desk-card-body.tsx into a reusable, selectable
// card-button group. Two selection modes:
//   single — radio semantics (desk 트렌드/시장조사, one active).
//   multi  — toggle semantics (probing 섹션 구성기 #470, on/off per card).
//
// Design-token only (4px/14px radius via rounded-sm, 1px→2px border, no
// shadow, single amore accent for the selected state). Per PROJECT.md §7.11
// color is NOT in a shared base — each selection branch owns its own full
// color set, so there is no base color for a variant to fight.
//
// Cascade note (variant='memphis', default): the button intentionally does
// NOT carry data-canvas-action. Inside a canvas widget ([data-canvas-body])
// globals.css governs the chrome (memphis white card) exactly as the
// pre-extraction inline cards did — so the desk/quotes rewire is visually
// unchanged. Outside canvas (/design-system) the cascade is absent and the
// amore/paper token styling below shows through as the primitive's own design.
//
// variant='flat' (quiet): the button DOES carry data-canvas-action, which is
// the documented escape hatch in globals.css :911 (`:not([data-canvas-action])`).
// This drops the memphis chrome (2.5px black border + 3px hard shadow +
// weight700 + 8px radius) even inside canvas, so the primitive's own token card
// (thin border-line-soft, no shadow, selected amore+✓) shows through and the
// grid reads calm. Used by the probing persona-section-configurator (#470/#521)
// where 8~9 multi-toggle cards otherwise felt busy. Desk/quotes stay memphis.

export type ModeOption = {
  /** Stable identity — echoed back through onChange / onToggle. */
  key: string;
  /** Bold card title. */
  label: string;
  /** Sub text under the title (line-clamped to 2). Also the hover tooltip. */
  description?: string;
  /** Emoji or SVG glyph rendered above the title. */
  icon?: ReactNode;
  /** Show the "soon" badge in place of the description (not-yet-live mode). */
  soon?: boolean;
  /** Text for the soon badge (i18n-resolved by the consumer). */
  soonLabel?: string;
  /** Non-selectable card (dimmed, no pointer). */
  disabled?: boolean;
};

const COLS: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

/** Chrome mode — 'memphis' (default, canvas bold cascade) | 'flat' (quiet token card). */
export type ModeVariant = 'memphis' | 'flat';

function cardClassName(selected: boolean, variant: ModeVariant): string {
  // flat 은 밀도 소폭 완화 (gap/padding 축소) — canvas memphis 를 벗은 뒤
  // 8~9 카드 격자가 더 차분해지도록. memphis 는 globals 카세이드가 padding 을
  // 덮으므로 여기 density 변경은 flat 에만 실효 (§7.11 색은 selected 분기 단독).
  const density = variant === 'flat' ? 'gap-1 p-2.5' : 'gap-1.5 p-3';
  return (
    'relative flex flex-col items-center rounded-sm border-[2px] ' +
    density +
    ' text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
    (selected
      ? 'border-amore bg-amore-bg'
      : 'border-line-soft bg-paper hover:bg-paper-soft')
  );
}

function CardInner({ option, variant }: { option: ModeOption; variant: ModeVariant }) {
  return (
    <>
      {option.icon != null ? (
        <span
          aria-hidden
          className={
            (variant === 'flat' ? 'text-lg' : 'text-xl') + ' leading-none'
          }
        >
          {option.icon}
        </span>
      ) : null}
      <span className="text-sm font-semibold text-ink">{option.label}</span>
      {option.soon ? (
        <span className="rounded-pill border border-line bg-white px-2 py-0.5 text-xs text-mute">
          {option.soonLabel}
        </span>
      ) : option.description ? (
        <span className="line-clamp-2 text-xs leading-[1.5] text-mute">
          {option.description}
        </span>
      ) : null}
    </>
  );
}

export type ModeButtonProps = {
  option: ModeOption;
  selected: boolean;
  onSelect: (key: string) => void;
  /** 'single' → role=radio + aria-checked · 'multi' → aria-pressed toggle. */
  selection: 'single' | 'multi';
  /** Chrome mode (default 'memphis'). 'flat' escapes the canvas memphis cascade. */
  variant?: ModeVariant;
};

/** A single selectable mode card. Usually consumed via <ModeCardGroup>. */
export function ModeButton({
  option,
  selected,
  onSelect,
  selection,
  variant = 'memphis',
}: ModeButtonProps) {
  const radio = selection === 'single';
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      // flat = globals.css :911 의 memphis 카세이드 탈출 (문서화된 escape hatch).
      data-canvas-action={variant === 'flat' ? '' : undefined}
      disabled={option.disabled}
      title={option.description}
      onClick={() => onSelect(option.key)}
      className={cardClassName(selected, variant)}
    >
      {selected ? (
        <span aria-hidden className="absolute right-2 top-2 text-amore">
          ✓
        </span>
      ) : null}
      <CardInner option={option} variant={variant} />
    </button>
  );
}

type CommonProps = {
  options: ModeOption[];
  /** Accessible name for the radiogroup / group. */
  ariaLabel: string;
  /** Card columns (default 2). */
  columns?: 1 | 2 | 3;
  className?: string;
  /**
   * Chrome mode (default 'memphis' — canvas bold cascade, unchanged).
   * 'flat' drops the memphis chrome via data-canvas-action so the quiet token
   * card shows through even inside canvas (probing persona configurator #521).
   */
  variant?: ModeVariant;
};

type SingleProps = CommonProps & {
  selection?: 'single';
  value: string;
  onChange: (key: string) => void;
};

type MultiProps = CommonProps & {
  selection: 'multi';
  selected: string[];
  onToggle: (key: string) => void;
};

export type ModeCardGroupProps = SingleProps | MultiProps;

/**
 * A group of selectable mode cards.
 * - single (default): radiogroup — `value` / `onChange`.
 * - multi:            group of toggles — `selected[]` / `onToggle`.
 */
export function ModeCardGroup(props: ModeCardGroupProps) {
  const { options, ariaLabel, columns = 2, className, variant = 'memphis' } = props;
  const multi = props.selection === 'multi';
  const gridClass = ['grid gap-2', COLS[columns], className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={ariaLabel} className={gridClass}>
      {options.map((opt) => {
        const selected = multi
          ? (props as MultiProps).selected.includes(opt.key)
          : (props as SingleProps).value === opt.key;
        return (
          <ModeButton
            key={opt.key}
            option={opt}
            selected={selected}
            selection={multi ? 'multi' : 'single'}
            variant={variant}
            onSelect={(key) =>
              multi
                ? (props as MultiProps).onToggle(key)
                : (props as SingleProps).onChange(key)
            }
          />
        );
      })}
    </div>
  );
}
