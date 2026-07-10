'use client';

import type { ReactNode } from 'react';

// Shared <Badge> — the DISPLAY-side chip primitive. Fills the gap the design
// audit (2026-07-10) found: ChipInput/ChipField cover INPUT chips (type a
// value, commit, remove to edit a list), but there was no primitive for
// read-only status / label / filter pills, so recruiting + probing each
// hand-rolled their own inline badge (3 divergent copies):
//   1. recruiting/distribution-panel FilterChips   — removable filter pill
//   2. probing/question-popup technique label       — neutral caps pill
//   3. probing/question-popup target-section label  — amore ◆ pill
//
// Role split — keep these straight:
//   Badge               = DISPLAY. A pill that shows a status / label / filter.
//                         Optional `onDismiss` renders a trailing × to remove it.
//   ChipInput/ChipField = INPUT. Type-and-commit list editing (ui/chip-*.tsx).
//
// Color lives on the VARIANT, never BASE — §7.11: Tailwind v4 resolves
// className conflicts by compiled-CSS source order, so a resting color in BASE
// could lose to a variant meant to override it. BASE holds layout / spacing /
// radius only; each variant owns border + bg + text.
//
// Variants are the MINIMUM set the three hand-rolled sites need (no
// speculative tones):
//   neutral — transparent fill + solid ink hairline  (probing technique label;
//             transparent so it reads the same on the paper card AND the
//             warning-bg high-importance card behind it)
//   subtle  — quiet ink/25 hairline on paper-soft     (recruiting filter chip)
//   amore   — brand accent on paper-soft              (probing target label)

export type BadgeVariant = 'neutral' | 'subtle' | 'amore';
export type BadgeSize = 'sm' | 'md';

// Layout / radius only — no color (§7.11). rounded-pill = the badge/chip
// capsule. whitespace-nowrap keeps a badge on one line; the inner label span
// owns truncation when a caller caps the width (e.g. max-w-[180px]).
const BASE =
  'inline-flex max-w-full items-center gap-1 rounded-pill whitespace-nowrap';

const VARIANT: Record<BadgeVariant, string> = {
  neutral: 'border border-ink text-ink-2',
  subtle: 'border border-ink/25 bg-paper-soft text-ink-2',
  amore: 'border border-amore bg-paper-soft text-amore',
};

// Padding + font size. Both mirror the three sites' px-2 py-0.5 text-xs
// footprint (sm); md is the one-step-up size for future denser-content uses.
const SIZE: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

type Props = {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  // Leading glyph (e.g. ◆). shrink-0 so it never truncates with the label.
  leadingIcon?: ReactNode;
  // When set, a trailing × removes the badge — the DISPLAY-chip dismiss
  // (matches ChipField's × pattern). The × is the removal control; the label
  // itself is not clickable.
  onDismiss?: () => void;
  // Accessible label for the × (i18n-owned by the caller) when onDismiss is
  // set. Falls back to a plain English label so the required aria-label is
  // never empty.
  dismissLabel?: string;
  className?: string;
};

export function Badge({
  children,
  variant = 'neutral',
  size = 'sm',
  leadingIcon,
  onDismiss,
  dismissLabel,
  className,
}: Props) {
  const cls = [BASE, VARIANT[variant], SIZE[size], className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls}>
      {leadingIcon ? (
        <span className="shrink-0" aria-hidden>
          {leadingIcon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {onDismiss ? (
        // data-canvas-action: opt out of the [data-canvas-body] button cascade
        // (globals.css injects padding/border on native buttons inside canvas
        // widgets) so this × keeps its bare glyph shape — same guard Button /
        // IconButton / probing ActionButton use. text-current lets the ×
        // inherit the badge variant's color.
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel ?? 'remove'}
          data-canvas-action
          className="-mr-0.5 shrink-0 leading-none text-current opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus-visible:opacity-100"
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </span>
  );
}
