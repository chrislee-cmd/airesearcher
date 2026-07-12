'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

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
// The 2px underline is no longer per-button: a single amore indicator span
// slides between tabs (measured from the active button's box) so switching
// tabs glides instead of jump-cutting the border. -mb-px pulls that indicator
// down onto the container's 1px bottom border so it sits flush on the seam.
const TAB_BASE =
  'relative -mb-px inline-flex items-center gap-1.5 px-3 py-2 ' +
  'text-sm uppercase tracking-[0.22em] transition-colors duration-[120ms] ' +
  'focus:outline-none focus-visible:text-amore';

const TAB_ACTIVE = 'text-ink-2';
const TAB_INACTIVE = 'text-mute hover:text-ink-2';

export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(
    null,
  );
  const reduced = useReducedMotion();

  // Measure the active tab's box relative to the tablist so the underline
  // can be absolutely positioned + transitioned. Re-runs on value/items
  // change; also on resize so the indicator tracks reflow (font load, wrap).
  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      const btn = btnRefs.current[value];
      if (!list || !btn) return;
      const lb = list.getBoundingClientRect();
      const bb = btn.getBoundingClientRect();
      setIndicator({ left: bb.left - lb.left, width: bb.width });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, items]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      data-ds-primitive="Tabs"
      className={['relative flex items-center gap-1', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              btnRefs.current[it.value] = el;
            }}
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
      {indicator && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 -mb-px h-0.5 bg-amore"
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: indicator.width,
            transition: reduced
              ? 'none'
              : 'transform var(--dur) var(--ease-out), width var(--dur) var(--ease-out)',
          }}
        />
      )}
    </div>
  );
}
