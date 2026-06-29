'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

// Shared <Checkbox> primitive — Memphis pop tone (2px ink border + 1.5px
// offset shadow + amore fill when checked + ✓ glyph). Replaces the legacy
// native + accent-amore pattern that left checkboxes visually indistinct
// between checked and unchecked states (user reported "오디오 + 전사록
// 저장" checkbox in 동시통역 widget — couldn't tell if it was checked).
//
// Implementation: native <input type="checkbox" appearance-none> for
// keyboard + form semantics, with a sibling SVG ✓ that fades in only when
// the input is :checked (via Tailwind's peer-checked: variant). Wrapper
// span establishes the positioning context; the SVG is absolutely centered
// with inset-0 + m-auto so it stays robust across sizes.
//
// Sizes: sm 16×16px (default — list rows / inline labels), md 20×20px
// (forms / settings). Both are large enough that the offset shadow reads
// without overpowering surrounding text.
//
// Usage: wrap with a <label> for click target and screen-reader text, or
// pass aria-label / aria-labelledby for icon-only contexts. The SVG is
// pointer-events:none so it can never swallow clicks.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  size?: 'sm' | 'md';
};

const SIZE = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
};

const CHECK_SIZE = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
};

const BASE =
  'peer appearance-none cursor-pointer shrink-0 ' +
  'border-2 border-ink rounded-xs bg-paper ' +
  'shadow-[1.5px_1.5px_0_black] ' +
  'checked:bg-amore checked:border-ink checked:shadow-[1.5px_1.5px_0_var(--color-amore)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ' +
  'transition-[background-color,box-shadow,border-color] duration-[120ms]';

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
          'pointer-events-none absolute inset-0 m-auto text-paper opacity-0 peer-checked:opacity-100 transition-opacity duration-[120ms] ' +
          CHECK_SIZE[size]
        }
      >
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
});
