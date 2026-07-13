'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <IconButton> primitive — codifies the recurring icon-only
// button patterns scattered across the app. Audit observed ~14 sites
// (workspace-panel 5, desk-research 1, translate-console 1, plus admin
// chrome ~5) that wrap a single glyph or SVG in
// a <button> with hover-color-only treatment.
//
// Variants (color/treatment):
//   ghost         text-mute → ink-2          most close/expand/menu cases
//   ghost-danger  text-mute → warning        deletes (× delete folder etc.)
//   ghost-brand   text-mute → amore          remove-keyword chips, accents
//   bordered      h-? w-? rounded-[4px] +
//                 border-line bg-paper +
//                 hover:border-amore         chrome toggles (e.g. speaker mute)
//   plain         text-mute → ink-2, NO      bare glyph — no box/bg/shadow at
//                 border/bg/shadow            all, hover changes color only.
//                                             For dense UI or icons already
//                                             sitting inside a bordered
//                                             container where a second Memphis
//                                             box would be visual noise.
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
  | 'bordered'
  | 'subtle'
  | 'plain';
export type IconButtonSize = 'compact' | 'sm' | 'md' | 'lg';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
};

// transition-all so Memphis translate + shadow morphs animate alongside
// color changes. disabled neutralizes transform/shadow so hover lift
// doesn't fight the disabled-state read.
const BASE =
  // duration = 모션 토큰(--dur-fast) SSOT. active:scale = 전역 press 피드백
  // (마이크로인터랙션 Foundation) — reduced-motion 시 중립. disabled 는 아래
  // transform-none 이 무력화.
  'transition-all duration-[var(--dur-fast)] focus:outline-none focus-visible:text-amore ' +
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:transform-none disabled:shadow-none';

// Memphis pop tone — boxed icon with 2px border + small hard shadow.
// ghost / ghost-danger / ghost-brand share the same chrome; only hover
// border / text / shadow tint changes per intent. `bordered` lands the
// loudest treatment (filled ink border + black shadow).
const VARIANT: Record<IconButtonVariant, string> = {
  ghost:
    'border-[2px] border-line bg-paper text-ink shadow-memphis-sm-faint ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-ink hover:shadow-memphis-md',
  'ghost-danger':
    'border-[2px] border-line bg-paper text-mute shadow-memphis-sm-faint ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-warning hover:text-warning ' +
    'hover:shadow-memphis-md-warning',
  'ghost-brand':
    'border-[2px] border-line bg-paper text-mute shadow-memphis-sm-faint ' +
    'hover:-translate-x-px hover:-translate-y-px hover:border-amore hover:text-amore ' +
    'hover:shadow-memphis-md-amore',
  bordered:
    'border-[2px] border-ink bg-paper text-ink shadow-memphis-sm ' +
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-memphis-md rounded-xs',
  // Subtle tone for header bands (yellow Topbar banner) — circular chip
  // with soft ink fill, no border/shadow. Pairs with Button `subtle` (pill
  // form) so the gear inside the account pill or alongside SignIn reads as
  // one family.
  subtle:
    'border-transparent rounded-full bg-ink/10 text-ink shadow-none ' +
    'hover:bg-ink/15',
  // Bare glyph — no box, background, or shadow at all; hover changes color
  // only (text-mute → ink-2). Restores the pre-#466 "hover-color-only" ghost
  // behavior as an explicit opt-in variant. §7.11: caller className cannot
  // strip a variant's border/bg via source order, so a dedicated variant is
  // the only reliable way to render an IconButton with zero chrome. Shares
  // BASE focus-visible:text-amore + active:scale for interaction consistency.
  plain: 'border-transparent bg-transparent shadow-none text-mute hover:text-ink-2',
};

const SIZE: Record<IconButtonSize, string> = {
  // inline-flex + centering + leading-none so callers that pass no padding
  // still render the glyph centered inside the Memphis bordered chrome
  // (PR #466 added border-2 + shadow to every variant; compact size had
  // no inline placement so the glyph sat off-box or clipped).
  compact: 'inline-flex items-center justify-center leading-none',
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
    // data-canvas-action: globals.css 의 [data-canvas-body] button cascade
    // (padding 0.4rem 0.85rem · border 2.5px · radius 8px) 에서 opt-out.
    // canvas widget 안에서 IconButton 의 28×28 박스가 globals padding 으로
    // content area 가 음수가 돼 svg 글리프 vanish 했던 회귀 (translate
    // SpeakerMute 등) 해소.
    <button
      ref={ref}
      type={type}
      className={cls}
      data-canvas-action
      {...rest}
      // 인스펙터 태그는 {...rest} 뒤 — 항상 존재(카탈로그 label = 'IconButton').
      data-ds-primitive="IconButton"
    >
      {children}
    </button>
  );
});
