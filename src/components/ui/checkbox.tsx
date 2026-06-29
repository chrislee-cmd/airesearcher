'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

// Shared <Checkbox> primitive — Memphis pop tone (2px ink border + amore
// fill when checked + ✓ glyph). Replaces the legacy native + accent-amore
// pattern that left checkboxes visually disconnected from the rest of the
// design system after the pop tone landed.
//
// Implementation: native <input type="checkbox" appearance-none> for
// keyboard + form semantics, with a peer ::before-style ✓ painted by a
// sibling SVG that fades in only when the input is :checked. The wrapper
// span establishes the positioning context.
//
// Usage: wrap with a <label> for click target and screen-reader text, or
// pass aria-label / aria-labelledby for icon-only contexts. Click target
// remains the input itself; the SVG overlay is pointer-events:none so it
// can never swallow clicks.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  size?: 'sm' | 'md';
};

const SIZE = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

const CHECK_SIZE = {
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
};

const BASE =
  'peer appearance-none cursor-pointer shrink-0 ' +
  'border-2 border-ink rounded-xs bg-paper ' +
  'checked:bg-amore checked:border-ink ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore ' +
  'disabled:cursor-not-allowed disabled:opacity-40 ' +
  'transition-colors duration-[120ms]';

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { size = 'sm', className, ...rest },
  ref,
) {
  const cls = [BASE, SIZE[size], className ?? ''].filter(Boolean).join(' ');
  return (
    <span className="relative inline-flex items-center justify-center">
      <input ref={ref} type="checkbox" className={cls} {...rest} />
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={
          'pointer-events-none absolute text-paper opacity-0 peer-checked:opacity-100 ' +
          CHECK_SIZE[size]
        }
      >
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
});
