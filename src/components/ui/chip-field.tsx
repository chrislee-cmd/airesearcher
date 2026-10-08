'use client';

import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ChipInput } from '@/components/ui/chip-input';
import { CloseButton } from '@/components/ui/close-button';

// Shared <ChipField> primitive — codifies the whole chip *container*, not
// just the extender input. Audit found 4 sites hand-rolling the identical
// skeleton (desk-card-body keyword input, translate-console glossary,
// project-tag-editor, share-invite-modal): a `focus-within:border-amore`
// frame + `rounded-pill border-amore` chips + a remove ✕ + a <ChipInput>.
// That copy-paste was the root of the #517/#519 divergence (each site drew
// the box slightly differently). ChipField folds container + chip pill +
// remove button + ChipInput into one primitive so the four variations
// (border weight, chip radius, commitOnComma, maxItems) collapse into props.
//
// This is a WRAPPER over <ChipInput> (the bare extender <input>), not a
// replacement — ChipInput still lives in ui/chip-input.tsx and ChipField
// renders it internally. Sites that only need the bare input keep using
// ChipInput directly.
//
// The remove ✕ is <CloseButton variant="chip-clear"> — a bare glyph with no
// box/bg/shadow. It replaces the older ghost-brand boxed ✕ the four sites
// used, so a second Memphis box no longer sits inside the chip pill (user
// request: background-less ✕ button). The glyph rests on the CD grey
// (#a3a7ad → text-mute-soft) and lifts to crimson on hover — the shared
// close-button contract (close-button-BUILD-SPEC §1-C), no longer hand-tuned
// here.
//
// Container color lives on the VARIANT, never BASE — §7.11: Tailwind v4
// resolves className conflicts by compiled-CSS source order, so a resting
// border color in BASE could lose to a variant that means to override it.
// BASE holds layout/spacing only; `focus-within:border-amore` is a
// pseudo-class state (higher specificity, wins regardless of order) so it
// stays shared in BASE safely.

type ChipFieldVariant = 'bordered' | 'subtle';

// Layout + the shared focus-within accent. No resting border color here.
const CONTAINER_BASE =
  'flex flex-wrap items-center gap-1.5 rounded-xs bg-paper px-3 py-2.5 ' +
  'min-h-[52px] focus-within:border-amore';

// Resting border color per variant (the one property that differs). bordered
// = the loud desk frame (2px ink, user #517 preference / default); subtle =
// the quiet border-line frame for dense/secondary contexts.
const CONTAINER_VARIANT: Record<ChipFieldVariant, string> = {
  bordered: 'border-[2px] border-ink',
  subtle: 'border border-line',
};

// CD `kwChip` (design-handoff/Widgets Canvas 1c.dc.html:440): 1.4px ink
// (#1d1b20) outline + ink text + white fill — NOT the amore (red) pill this
// primitive shipped with. `border-ink`/`text-ink` = --raw-ink-100 = #1d1b20,
// an exact promotion of the CD value (user decision: global CHIP blanket, not
// a desk-only variant). radius/padding/gap stay on the existing tokens; only
// the color treatment is corrected to conform.
const CHIP =
  'inline-flex items-center gap-1 rounded-pill border border-ink ' +
  'bg-paper px-2.5 py-0.5 text-xs text-ink';

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  // Empty-state vs. has-chips placeholder (matches the 4 sites' pattern of
  // showing a fuller prompt when empty and a terse "add more" once non-empty).
  placeholderEmpty?: string;
  placeholderAdd?: string;
  maxItems?: number;
  maxLength?: number;
  // Also commit on "," — email / comma-separated lists (share-invite-modal).
  commitOnComma?: boolean;
  disabled?: boolean;
  variant?: ChipFieldVariant;
  // aria-label for each chip's remove ×; i18n-owned by the caller. Falls back
  // to a plain English label so the required aria-label is never empty.
  chipRemoveLabel?: (value: string) => string;
  inputType?: 'text' | 'email';
  // Extra classes for the inner ChipInput (min-width / flex-1 tuning). The
  // right min-width depends on the surrounding layout, so callers pass it.
  inputClassName?: string;
  className?: string;
};

const norm = (s: string) => s.trim();

export function ChipField({
  values,
  onChange,
  placeholderEmpty,
  placeholderAdd,
  maxItems,
  maxLength,
  commitOnComma,
  disabled,
  variant = 'bordered',
  chipRemoveLabel,
  inputType = 'text',
  inputClassName,
  className,
}: Props) {
  const [draft, setDraft] = useState('');

  const atMax = maxItems != null && values.length >= maxItems;

  // Commit guards, unified from the 4 sites: trim → drop blank → respect
  // maxLength (slice) → respect maxItems → drop exact duplicate. Consumers
  // with looser dedup (case-insensitive email/tags) normalize before this in
  // Phase 2 wiring; the primitive default is a conservative exact match.
  const commit = (raw: string) => {
    const value = maxLength != null ? norm(raw).slice(0, maxLength) : norm(raw);
    setDraft('');
    if (!value) return;
    if (maxItems != null && values.length >= maxItems) return;
    if (values.includes(value)) return;
    onChange([...values, value]);
  };

  const removeAt = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  // Backspace on an empty draft pops the last chip — the shared "editing the
  // draft feels continuous with the chips" behavior. Enter/comma commit is
  // owned by <ChipInput onCommit> (IME-guarded) so it isn't re-derived here.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && draft.length === 0 && values.length > 0) {
      e.preventDefault();
      removeAt(values.length - 1);
    }
  };

  const removeLabel = (value: string) =>
    chipRemoveLabel ? chipRemoveLabel(value) : `remove ${value}`;

  const containerCls = [
    CONTAINER_BASE,
    CONTAINER_VARIANT[variant],
    disabled ? 'opacity-50' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerCls} data-ds-primitive="ChipField">
      {values.map((value, idx) => (
        <span key={`${idx}-${value}`} className={CHIP}>
          {value}
          {/* 칩 제거 = BUILD-SPEC §1-C chip-clear: 16×16 · pill · 글리프만 ·
              mute-soft → hover crimson. 칩 자체가 이미 테두리라 상자를 겹치지
              않는다(§0-4). CD kwChip x 의 rest 그레이(#a3a7ad→mute-soft)는
              변종이 직접 소유하므로 className 으로 색을 덧대지 않는다(§7.11). */}
          <CloseButton
            variant="chip-clear"
            onClick={() => removeAt(idx)}
            disabled={disabled}
            aria-label={removeLabel(value)}
          />
        </span>
      ))}
      <ChipInput
        type={inputType}
        value={draft}
        maxLength={maxLength}
        onChange={(e) =>
          setDraft(
            maxLength != null
              ? e.target.value.slice(0, maxLength)
              : e.target.value,
          )
        }
        onCommit={commit}
        commitOnComma={commitOnComma}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        disabled={disabled || atMax}
        placeholder={values.length === 0 ? placeholderEmpty : placeholderAdd}
        className={['min-w-[120px] flex-1 text-xs', inputClassName ?? '']
          .filter(Boolean)
          .join(' ')}
      />
    </div>
  );
}
