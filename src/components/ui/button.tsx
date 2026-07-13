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
  | 'destructive-link'
  | 'subtle';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'cta';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  // 슈퍼어드민 DS 인스펙터용 primitive 이름(카탈로그 label). 기본 'Button'.
  // Button 을 자기 chrome 으로 재사용하는 상위 primitive(DownloadMenu/ShareMenu)가
  // 자기 이름으로 덮어써 인스펙터에 정확한 primitive 를 노출한다.
  dsPrimitive?: string;
};

// transition-all (not just transition-colors) so Memphis hover/active
// translate + shadow morphs animate alongside color changes.
// disabled:{transform-none,shadow-none} neutralizes hover lift when disabled
// so opacity-40 read stays flat.
const BASE =
  'inline-flex items-center justify-center gap-1.5 border font-semibold ' +
  // duration 은 모션 토큰(--dur-fast) SSOT 참조 — 하드코드 산발 금지.
  'transition-all duration-[var(--dur-fast)] ' +
  // 전역 press 피드백(마이크로인터랙션 Foundation). Memphis active translate/
  // shadow(variant) 위에 scale 이 합성돼 "눌림" 촉감을 더한다. reduced-motion
  // 시 scale 중립(motion-reduce). disabled 는 아래 transform-none 이 무력화.
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 ' +
  'disabled:transform-none disabled:shadow-none ' +
  // Border-driven focus matches existing app pattern; loud ring left to
  // app-wide a11y pass (P0 in audit) so this primitive stays drop-in.
  'focus:outline-none focus-visible:border-amore';

// Memphis pop tone — 2.5px border + 3px hard shadow, lifts on hover, sinks
// on active. link/destructive-link stay flat (text-only identity).
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-[2.5px] border-ink bg-ink text-paper shadow-memphis-md ' +
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-memphis-lg ' +
    'active:translate-x-0 active:translate-y-0 active:shadow-memphis-2xs',
  secondary:
    'border-[2.5px] border-ink bg-paper text-ink shadow-memphis-md ' +
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-memphis-lg hover:bg-paper-soft ' +
    'active:translate-x-0 active:translate-y-0 active:shadow-memphis-2xs',
  ghost:
    'border-[2.5px] border-line bg-paper text-ink shadow-memphis-sm-faint ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-ink hover:shadow-memphis-md',
  destructive:
    'border-[2.5px] border-line bg-paper text-ink shadow-memphis-sm-faint ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-warning hover:text-warning ' +
    'hover:shadow-memphis-md-warning',
  // Text-only neutral action (e.g. "switch to sign up", inline cancels).
  link:
    'border-transparent bg-transparent text-mute hover:text-ink-2 ' +
    'underline decoration-2 underline-offset-4 decoration-transparent hover:decoration-ink',
  // Text-only delete action (8 sites: row deletes, panel removes).
  'destructive-link':
    'border-transparent bg-transparent text-mute hover:text-warning ' +
    'underline decoration-2 underline-offset-4 decoration-transparent hover:decoration-warning',
  // Subtle tone for header bands (yellow Topbar banner) — pill chip with
  // soft ink fill, no border/shadow. Form-language matches TopbarTabs so
  // the whole topbar reads as one family; hover deepens the fill instead
  // of the Memphis translate/shadow lift used by primary/secondary.
  subtle:
    'border-transparent rounded-full bg-ink/10 text-ink-2 shadow-none ' +
    'hover:bg-ink/15',
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
    dsPrimitive = 'Button',
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
    // data-canvas-action: globals.css 의 [data-canvas-body] button cascade
    // (background:#fff · color:#000 · border 2.5px) 에서 opt-out.
    // 위 cascade 는 attribute selector specificity (0,2,1) 가 Tailwind utility
    // (0,1,0) 를 이겨 variant primary 의 bg-ink 까지 흰색으로 덮어쓰는 회귀가
    // 있어, canvas widget 안 region/preset toggle 의 선택 시각이 사라졌습니다.
    // Button primitive 는 자체 chrome 을 가지므로 항상 opt-out 이 맞음
    // (IconButton 과 동일 패턴). canvas 외부에서는 cascade 자체가 적용 안 돼
    // 부작용 0.
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls}
      data-canvas-action
      {...rest}
      // 인스펙터 태그는 {...rest} 뒤 — consumer 가 실수로 덮지 못하게 항상 존재.
      data-ds-primitive={dsPrimitive}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
});
