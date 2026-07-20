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
//   primary   amore-bg fill, text-paper   "go" CTAs in chrome contexts
//                                         (translate Start / Unlock, viewer
//                                         "Tap to enable audio")
//
// Sizes:
//   xs   px-2 py-0.5 text-xs-soft       in-row chrome (workspace subfolder)
//   sm   px-2 py-1   text-xs-soft       standalone chrome (workspace Create)
//   md   h-7 px-2    text-sm       small toolbar (translate Copy)
//   lg   h-8 px-3    text-md       toolbar chrome (translate Stop)
//
// `uppercase` toggles the caps treatment used by workspace chrome
// (font-semibold + uppercase + tracking-[0.18em]). Translate chrome
// stays sentence-case.

export type ChromeButtonVariant = 'default' | 'mute' | 'primary';
export type ChromeButtonSize = 'xs' | 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ChromeButtonVariant;
  size?: ChromeButtonSize;
  uppercase?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

// BASE intentionally does NOT set border-color/background — each variant
// owns those so `primary`'s amore fill isn't fighting with (and
// unpredictably losing to) `border-line bg-paper` under Tailwind's
// class-order resolution. This was the root cause of the translate
// Start/Unlock buttons rendering as paper-bg + paper-text (invisible
// label) after #230 migrated them off the native <button>.
const BASE =
  'border rounded-xs ' +
  // `transition`(색+transform 포함) + 모션 토큰 duration. active:scale = 전역
  // press 피드백(마이크로인터랙션 Foundation). transition-colors 였다면 scale 이
  // 애니메이션 안 되므로 transform 포함 그룹으로 교체. reduced-motion 시 중립.
  'transition duration-[var(--dur-fast)] ' +
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed ' +
  'focus:outline-none focus-visible:border-amore';

const VARIANT: Record<ChromeButtonVariant, string> = {
  default: 'border-line bg-paper text-ink hover:border-amore',
  mute: 'border-line bg-paper text-mute hover:border-amore hover:text-ink-2',
  // amore brand fill. hover:opacity-90 mirrors translate-viewer "Tap to
  // enable audio" (which had a native <button>).
  primary: 'border-amore bg-amore text-paper hover:opacity-90',
};

const SIZE: Record<ChromeButtonSize, string> = {
  xs: 'px-2 py-0.5 text-xs-soft',
  sm: 'px-2 py-1 text-xs-soft',
  md: 'inline-flex h-7 items-center px-2 text-sm',
  lg: 'inline-flex h-8 items-center px-3 text-md',
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
    <button
      ref={ref}
      type={type}
      className={cls}
      {...rest}
      // data-canvas-action — ChromeButton 은 variant 로 자기 chrome(border/bg)을
      // 소유하므로 canvas cascade([data-canvas-body] button:not([data-canvas-action]))
      // 의 memphis 오버라이드에서 opt-out 해야 한다. 안 그러면 primary=bg-amore 가
      // 흰 surface-card 로 덮여 Start CTA 가 흰 memphis 버튼이 되고, 그 위 흰 mono
      // 아이콘이 투명해져 실종됐다(#1083 Rev1-C). BASE 주석의 #230 경고와 동일 위험.
      data-canvas-action
      data-ds-primitive="ChromeButton"
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
});
