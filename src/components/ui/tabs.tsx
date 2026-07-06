'use client';

import type { ReactNode } from 'react';

// Shared <Tabs> primitive — codifies the app's editorial underline-tab
// pattern (uppercase + tracking, active = ink text + 2px amore underline,
// inactive = mute → ink-2 on hover). Previously each surface hand-rolled
// this with a `Button variant="ghost"` + a stack of `!important` overrides
// (`!border-b-2 !border-amore !text-ink-2 …`) to fight the Button
// primitive's own chrome — brittle, un-reusable, and a design-system-lint
// smell. This primitive owns the tokens directly so callers pass data, not
// className hacks.
//
// Controlled only: caller holds the active value in state and re-renders on
// change. `role="tablist"` + `role="tab"` + `aria-selected` make it
// keyboard/AT legible without extra wiring.

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
};

type Props<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  'aria-label': string;
  className?: string;
};

// Base owns layout/typography only (per §7.11 — color lives in the
// active/inactive branches so nothing fights class-order resolution).
// -mb-px pulls each tab's 2px underline down onto the container's 1px
// bottom border so the active amore line sits flush on that seam.
const TAB_BASE =
  'relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 ' +
  'text-sm uppercase tracking-[0.22em] transition-colors duration-[120ms] ' +
  'focus:outline-none focus-visible:text-amore';

const TAB_ACTIVE = 'border-amore text-ink-2';
const TAB_INACTIVE = 'border-transparent text-mute hover:text-ink-2';

export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={['flex items-center gap-1', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(it.value)}
            className={[TAB_BASE, active ? TAB_ACTIVE : TAB_INACTIVE].join(' ')}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
