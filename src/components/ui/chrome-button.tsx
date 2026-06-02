'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <ChromeButton> primitive — codifies the recurring "4px-radius
// chrome" pattern used by tool-row utility actions. Distinct from
// <Button> (14px capsule, sentence-case CTAs) by design: chrome is
// deliberately squared and quieter so primary CTAs stand out.
//
// Audit observed ~15+ sites — workspace-panel project/folder chrome
// (Create / Refresh) and translate-console toolbar (Stop / Copy /
// Revoke / 4× Download).
//
// Variants (text color):
//   default   text-ink                    most chrome (translate)
//   mute      text-mute → ink-2           workspace chrome with hover lift
//
// Sizes:
//   xs   px-2 py-0.5 text-[10.5px]       in-row chrome (workspace subfolder)
//   sm   px-2 py-1   text-[10.5px]       standalone chrome (workspace Create)
//   md   h-7 px-2    text-[11.5px]       small toolbar (translate Copy)
//   lg   h-8 px-3    text-[12.5px]       toolbar chrome (translate Stop)
//
// `uppercase` toggles the caps treatment used by workspace chrome
// (font-semibold + uppercase + tracking-[0.18em]). Translate chrome
// stays sentence-case.

export type ChromeButtonVariant = 'default' | 'mute';
export type ChromeButtonSize = 'xs' | 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ChromeButtonVariant;
  size?: ChromeButtonSize;
  uppercase?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const BASE =
  'border border-line bg-paper [border-radius:4px] ' +
  'transition-colors duration-[120ms] hover:border-amore ' +
  'disabled:opacity-40 disabled:cursor-not-allowed ' +
  'focus:outline-none focus-visible:border-amore';

const VARIANT: Record<ChromeButtonVariant, string> = {
  default: 'text-ink',
  mute: 'text-mute hover:text-ink-2',
};

const SIZE: Record<ChromeButtonSize, string> = {
  xs: 'px-2 py-0.5 text-[10.5px]',
  sm: 'px-2 py-1 text-[10.5px]',
  md: 'inline-flex h-7 items-center px-2 text-[11.5px]',
  lg: 'inline-flex h-8 items-center px-3 text-[12.5px]',
};

const UPPERCASE = 'font-semibold uppercase tracking-[0.18em]';

export const ChromeButton = forwardRef<HTMLButtonElement, Props>(function ChromeButton(
  {
    variant = 'default',
    size = 'sm',
    uppercase = false,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [
    BASE,
    VARIANT[variant],
    SIZE[size],
    uppercase ? UPPERCASE : '',
    fullWidth ? 'w-full' : '',
    leftIcon || rightIcon ? 'inline-flex items-center gap-1.5' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
});
