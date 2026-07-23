'use client';

import type { ReactNode } from 'react';
import { Checkbox } from './checkbox';

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
// Cascade note: the button intentionally does NOT carry data-canvas-action.
// Inside a canvas widget ([data-canvas-body]) globals.css governs the chrome
// (memphis white card) exactly as the pre-extraction inline cards did — so
// the desk rewire is visually unchanged. Outside canvas (/design-system,
// #470) the cascade is absent and the amore/paper token styling below shows
// through as the primitive's own design.

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

const COLS: Record<1 | 2 | 3 | 6, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  6: 'grid-cols-6',
};

// variant:
//   default — 고정 높이 128 카드 (Canvas 1c 델타 MODECARD-FIX.md). 이전엔 내용
//     높이만큼 가변이라 같은 행의 1줄/2줄 카드 높이가 어긋났다 → 고정 128 +
//     top-align(justify-start) + title/subtitle clamp 로 그리드 정렬을 봉인.
//     desk 트렌드/시장조사, transcript 방식, UT 방식 등 method 카드 그리드 공유.
//   flat    — 정사각형 카드 (aspect-square). probing 페르소나 섹션 구성기 한정.
//     6열 square 라 카드가 작아 아이콘·제목이 항상 보이도록 위→아래 흐름
//     (justify-start) + 넘치는 설명은 overflow-hidden 으로 하단부터 클립
//     (설명은 이미 line-clamp-2). 중앙정렬이면 넘칠 때 상단 아이콘이 잘림.
export type ModeVariant = 'default' | 'flat';

function cardClassName(selected: boolean, variant: ModeVariant): string {
  if (variant === 'flat') {
    // 정사각형 카드 — 항상 흰(paper) 배경 + 얇은 테두리. 선택 표시는 카드 색이
    // 아니라 내부 Checkbox 가 단독으로 담당한다 (카드는 안 바뀜). ⚠️ 델타 범위 밖 —
    // 절대 건드리지 말 것 (MODECARD-FIX 는 default variant 한정).
    return (
      'relative flex aspect-square flex-col items-center justify-start gap-1.5 ' +
      'overflow-hidden rounded-sm border-[2px] border-line-soft bg-paper p-3 text-center'
    );
  }
  // default — 고정 128 프레임(box-border, flex column, top-align). 남는 공간은
  // 카드 하단 패딩으로 한 번에 모임 (justify-content:space-between 금지 — 내부 갭
  // 재발). radius 13/shadow glow 는 proposed 토큰(rounded-mode-card·
  // shadow-select-glow). border 폭은 idle/selected 동일 border-2 로 유지해 선택
  // 시 reflow 를 막고 색만 swap (CD 1.4/2 는 stand-alone 렌더 값 — 보수적으로 폭
  // 고정, canvas 안에서는 어차피 memphis globals 가 폭을 governs). 높이/clamp/
  // top-align 는 canvas·비-canvas 양쪽 모두 적용되는 핵심 델타.
  return (
    'relative flex flex-col items-center justify-start box-border h-[var(--mode-card-h)] ' +
    'rounded-mode-card border-2 py-[13px] px-[11px] text-center transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-40 ' +
    (selected
      ? 'border-amore bg-paper shadow-select-glow'
      : 'border-line bg-paper hover:bg-paper-soft')
  );
}

function CardInner({ option }: { option: ModeOption }) {
  return (
    <>
      {option.icon != null ? (
        <span aria-hidden className="text-xl leading-none">
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

// default variant 전용 inner — Canvas 1c 델타(MODECARD-FIX.md) 텍스트 규칙.
// flat 용 CardInner 와 분리해 flat 불변(제약)을 보장한다.
//   · 아이콘: mb-0.5(2px)·shrink-0 — 아이콘 블록 불변(현 emoji text-xl 유지).
//   · title: 12.5/700 ink · lh1.25 · clamp-2. 12.5px = text-md(정확 일치),
//     700 = font-bold. 아이콘 아래 mt-[7px]. 넘치면 native title 툴팁(button 이
//     이미 title={description} 보유; label 은 clamp 뿐이라 상시 표시).
//   · subtitle: 9.5/400 #5b5965 · lh1.4. #5b5965 = text-mute(--color-mute 정확
//     일치), 400 = 기본. 9.5px 는 eslint text-[Npx] 하드가드로 막혀 있고 DS 폰트
//     스케일이 9/9.5/10 을 text-xs(10)로 흡수하도록 문서화돼 있어(보수적 해석)
//     text-xs 사용. title 에 바짝 mt-[3px]. 현 데이터모델은 단일 description
//     문자열 → 단일 clamp-2 케이스(멀티-프래그먼트 배열은 데이터가 배열 제공 시
//     후속; 규칙: 각 clamp-1 + .slice(0,2)).
function DefaultCardInner({ option }: { option: ModeOption }) {
  return (
    <>
      {option.icon != null ? (
        <span aria-hidden className="mb-0.5 shrink-0 text-xl leading-none">
          {option.icon}
        </span>
      ) : null}
      <span className="mt-[7px] line-clamp-2 text-md font-bold leading-[1.25] text-ink">
        {option.label}
      </span>
      {option.soon ? (
        <span className="mt-[3px] rounded-pill border border-line bg-white px-2 py-0.5 text-xs text-mute">
          {option.soonLabel}
        </span>
      ) : option.description ? (
        <span className="mt-[3px] line-clamp-2 text-xs font-normal leading-[1.4] text-mute">
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
  /** 'flat' → 정사각형 카드 (persona 한정). 기본 'default'. */
  variant?: ModeVariant;
};

/** A single selectable mode card. Usually consumed via <ModeCardGroup>. */
export function ModeButton({
  option,
  selected,
  onSelect,
  selection,
  variant = 'default',
}: ModeButtonProps) {
  const radio = selection === 'single';

  // flat variant (persona) = 흰 배경 카드(div, 클릭 대상 아님) + 내부 Checkbox.
  // 토글·선택 표시는 이 Checkbox 가 단독 담당 (onChange → onSelect, 체크는
  // 텍스트 아래 중앙). 카드 전체를 클릭 대상으로 만들지 않는다.
  if (variant === 'flat') {
    return (
      <div
        className={cardClassName(selected, variant)}
        data-ds-primitive="ModeButton"
      >
        <CardInner option={option} />
        <Checkbox
          checked={selected}
          onChange={() => onSelect(option.key)}
          disabled={option.disabled}
          aria-label={option.label}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      // canvas([data-canvas-body]) 안에서 memphis 검정 border 가 .border-amore 를
      // 덮으므로, globals.css 가 이 훅으로 selected 시 accent border 를 되살린다.
      data-mode-card=""
      disabled={option.disabled}
      title={option.description}
      onClick={() => onSelect(option.key)}
      className={cardClassName(selected, variant)}
      data-ds-primitive="ModeButton"
    >
      {/* default variant selected = amore 보더(+ 비-canvas 에선 select glow)만.
          배경색·우상단 ✓ 배지는 제거된 상태 유지 (제약: check-badge 재도입 금지). */}
      <DefaultCardInner option={option} />
    </button>
  );
}

/**
 * 비선택 액션 카드 — 토글(✓) 이 아닌 클릭 동작용 (예: "+ 섹션 추가").
 * ModeButton 과 동일한 카드 shell(cardClassName) 을 써서 그리드 안에서 다른
 * 카드와 시각적으로 동일한 정사각형(flat) 으로 보인다. icon + label 만 —
 * 서브텍스트 없음(짤림 0).
 */
export function ModeActionCard({
  icon,
  label,
  onClick,
  disabled = false,
  variant = 'default',
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: ModeVariant;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cardClassName(false, variant)}
    >
      {icon != null ? (
        <span aria-hidden className="text-xl leading-none">
          {icon}
        </span>
      ) : null}
      <span className="text-sm font-semibold text-ink">{label}</span>
    </button>
  );
}

type CommonProps = {
  options: ModeOption[];
  /** Accessible name for the radiogroup / group. */
  ariaLabel: string;
  /** Card columns (default 2). */
  columns?: 1 | 2 | 3 | 6;
  /** 'flat' → 정사각형 카드 (persona 한정). 기본 'default'. */
  variant?: ModeVariant;
  /** 그리드 마지막 셀에 붙는 추가 노드 (예: <ModeActionCard>). */
  append?: ReactNode;
  className?: string;
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
  const { options, ariaLabel, columns = 2, variant = 'default', append, className } =
    props;
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
      {append}
    </div>
  );
}
