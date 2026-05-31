'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <Button> primitive — codifies the inline patterns scattered across
// the app (181 native <button> JSX sites observed in 2026-05-31 audit).
//
// Source of truth for variant/size: docs/design-system-v2-draft.md §7.1.
// Visuals match recruiting-brief.tsx / projects-view.tsx / etc. so a
// migration is purely a search-and-replace — no design change.
//
// Status: NOT YET CONSUMED. File is exported but no caller imports it,
// so production bundles tree-shake it out. Migrations happen in
// separate PRs (page-by-page) so each visual regression risk is local.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

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
  'transition-colors duration-[120ms] [border-radius:14px] ' +
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
};

const SIZE: Record<ButtonSize, string> = {
  // Sizes match the dominant inline patterns. uppercase-action style is
  // the caller's choice (apply uppercase + tracking on the label) — not
  // baked into size so existing labels migrate cleanly.
  xs: 'px-2.5 py-1 text-[10.5px]',
  sm: 'px-4 py-1.5 text-[11.5px]',
  md: 'px-5 py-2 text-[12px]',
  lg: 'px-5 py-2.5 text-[13px]',
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
