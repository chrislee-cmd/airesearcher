'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <Button> primitive — codifies the inline patterns scattered across
// the app (177 native <button> JSX sites observed in 2026-05-31 audit).
//
// Variants:
//   primary / secondary / ghost / destructive  — capsule-shape actions
//   link / destructive-link                    — text-only inline actions
// Sizes:
//   xs / sm / md / lg                          — capsule sizes (rounded-sm)
//   cta                                        — pill (rounded-full) hero CTA

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'link'
  | 'destructive-link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'cta';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

// transition-all (not just transition-colors) so Memphis hover/active
// translate + shadow morphs animate alongside color changes.
// disabled:{transform-none,shadow-none} neutralizes hover lift when disabled
// so opacity-40 read stays flat.
const BASE =
  'inline-flex items-center justify-center gap-1.5 border font-semibold ' +
  'transition-all duration-[120ms] ' +
  'disabled:cursor-not-allowed disabled:opacity-40 ' +
  'disabled:transform-none disabled:shadow-none ' +
  // Border-driven focus matches existing app pattern; loud ring left to
  // app-wide a11y pass (P0 in audit) so this primitive stays drop-in.
  'focus:outline-none focus-visible:border-amore';

// Memphis pop tone — 2.5px border + 3px hard shadow, lifts on hover, sinks
// on active. link/destructive-link stay flat (text-only identity).
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-[2.5px] border-ink bg-ink text-paper shadow-[3px_3px_0_black] ' +
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_black] ' +
    'active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0_black]',
  secondary:
    'border-[2.5px] border-ink bg-paper text-ink shadow-[3px_3px_0_black] ' +
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_black] hover:bg-paper-soft ' +
    'active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0_black]',
  ghost:
    'border-[2.5px] border-line bg-paper text-ink shadow-[2px_2px_0_rgba(0,0,0,0.15)] ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-ink hover:shadow-[3px_3px_0_black]',
  destructive:
    'border-[2.5px] border-line bg-paper text-ink shadow-[2px_2px_0_rgba(0,0,0,0.15)] ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-warning hover:text-warning ' +
    'hover:shadow-[3px_3px_0_var(--color-warning)]',
  // Text-only neutral action (e.g. "switch to sign up", inline cancels).
  link:
    'border-transparent bg-transparent text-mute hover:text-ink-2 ' +
    'underline decoration-2 underline-offset-4 decoration-transparent hover:decoration-ink',
  // Text-only delete action (8 sites: row deletes, panel removes).
  'destructive-link':
    'border-transparent bg-transparent text-mute hover:text-warning ' +
    'underline decoration-2 underline-offset-4 decoration-transparent hover:decoration-warning',
};

// SIZE owns padding/font/radius only — transition lives on BASE so the
// Memphis hover lift animates uniformly across sizes. `cta` drops its
// legacy soft-shadow hover; variant supplies the Memphis hard shadow.
const SIZE: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1 text-xs-soft rounded-sm',
  sm: 'px-4 py-1.5 text-sm rounded-sm',
  md: 'px-5 py-2 text-md rounded-sm',
  lg: 'px-5 py-2.5 text-lg rounded-sm',
  cta: 'px-4 py-3 text-sm uppercase tracking-[0.22em] rounded-full',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'sm',
    loading = false,
    loadingLabel,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [
    BASE,
    VARIANT[variant],
    SIZE[size],
    fullWidth ? 'w-full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls}
      {...rest}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
});
