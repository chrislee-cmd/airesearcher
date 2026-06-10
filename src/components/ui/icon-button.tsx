'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <IconButton> primitive — codifies the recurring icon-only
// button patterns scattered across the app. Audit observed ~14 sites
// (workspace-panel 5, voice-concierge 2, desk-research 1, translate-
// console 1, plus admin chrome ~5) that wrap a single glyph or SVG in
// a <button> with hover-color-only treatment.
//
// Variants (color/treatment):
//   ghost         text-mute → ink-2          most close/expand/menu cases
//   ghost-danger  text-mute → warning        deletes (× delete folder etc.)
//   ghost-brand   text-mute → amore          remove-keyword chips, accents
//   bordered      h-? w-? rounded-[4px] +
//                 border-line bg-paper +
//                 hover:border-amore         chrome toggles (e.g. speaker mute)
//
// Sizes (shape):
//   compact   no fixed h/w, inline; honors className for padding/text
//             Use for inline ×/+ glyphs in text rows where height is
//             driven by surrounding line-height (most workspace-panel
//             cases). Caller controls text-size + leading.
//   sm        h-6 w-6 centered (default for stand-alone icon triggers)
//   md        h-7 w-7 centered (chrome toggles)
//   lg        h-8 w-8 centered (toolbar)
//
// REQUIRED: aria-label. Icon-only controls without a label are
// unusable by screen readers; the type forces callers to pass one.

export type IconButtonVariant =
  | 'ghost'
  | 'ghost-danger'
  | 'ghost-brand'
  | 'bordered';
export type IconButtonSize = 'compact' | 'sm' | 'md' | 'lg';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
};

const BASE = 'transition-colors duration-[120ms] focus:outline-none focus-visible:text-amore';

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'text-mute-soft hover:text-ink-2',
  'ghost-danger': 'text-mute-soft hover:text-warning',
  'ghost-brand': 'text-mute hover:text-amore',
  bordered:
    'border border-line bg-paper text-ink hover:border-amore rounded-xs',
};

const SIZE: Record<IconButtonSize, string> = {
  compact: '',
  sm: 'inline-flex h-6 w-6 items-center justify-center',
  md: 'inline-flex h-7 w-7 items-center justify-center',
  lg: 'inline-flex h-8 w-8 items-center justify-center',
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  {
    variant = 'ghost',
    size = 'compact',
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [BASE, VARIANT[variant], SIZE[size], className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {children}
    </button>
  );
});
