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

const BASE =
  'inline-flex items-center justify-center gap-1.5 border font-semibold ' +
  'disabled:cursor-not-allowed disabled:opacity-40 ' +
  // Border-driven focus matches existing app pattern; loud ring left to
  // app-wide a11y pass (P0 in audit) so this primitive stays drop-in.
  'focus:outline-none focus-visible:border-amore';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-ink bg-ink text-paper hover:bg-ink-2',
  secondary:
    'border-ink bg-paper text-ink hover:bg-ink hover:text-paper',
  ghost:
    'border-line bg-paper text-mute hover:border-mute-soft hover:text-ink-2',
  destructive:
    'border-line bg-paper text-mute hover:border-warning hover:text-warning',
  // Text-only neutral action (e.g. "switch to sign up", inline cancels).
  link:
    'border-transparent bg-transparent text-mute hover:text-ink-2',
  // Text-only delete action (8 sites: row deletes, panel removes).
  'destructive-link':
    'border-transparent bg-transparent text-mute hover:text-warning',
};

// Each size carries its own radius + transition so `cta` (pill, transition-all)
// fully overrides the default capsule (14px, transition-colors) regardless of
// CSS source order.
const SIZE: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1 text-xs-soft rounded-sm transition-colors duration-[120ms]',
  sm: 'px-4 py-1.5 text-sm rounded-sm transition-colors duration-[120ms]',
  md: 'px-5 py-2 text-md rounded-sm transition-colors duration-[120ms]',
  lg: 'px-5 py-2.5 text-lg rounded-sm transition-colors duration-[120ms]',
  cta:
    'px-4 py-3 text-sm uppercase tracking-[0.22em] rounded-full ' +
    'transition-all duration-[120ms] hover:-translate-y-px ' +
    'hover:shadow-[0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)]',
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
