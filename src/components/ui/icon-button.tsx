'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <IconButton> primitive — codifies the recurring icon-only
// button patterns scattered across the app. Audit observed ~14 sites
// (workspace-panel 5, desk-research 1, translate-console 1, plus admin
// chrome ~5) that wrap a single glyph or SVG in
// a <button> with hover-color-only treatment.
//
// Variants (color/treatment):
//   ghost         흰 면 + 1px --line        most close/expand/menu cases
//   ghost-danger  hover --danger             deletes (× delete folder etc.)
//   ghost-brand   hover ink                  remove-keyword chips, accents
//   bordered      원형 + border 1 --line + --surface +
//                 hover:--line-hover         chrome toggles (e.g. speaker mute)
//   plain         text-mute → ink, NO        bare glyph — no box/bg/shadow at
//                 border/bg/shadow            all, hover changes color only.
//                                             For dense UI or icons already
//                                             sitting inside a bordered
//                                             container where a second box
//                                             would be visual noise.
//
// **Soft Identity 리브랜드 1단계** — 변환표 "아이콘 버튼은 38 원"(핵심규칙 5).
// 모든 variant 가 pill(원형) + 1px 선 또는 선 없음 + 그림자 0 + hover 색만.
// 치수(h/w·hit area)는 불변 — radius/색/선/그림자만 교체.
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

// transition-colors — Soft hover 는 색만. disabled 는 press scale/그림자를
// 중립화한다.
const BASE =
  // `border` = 1px 폭(핵심규칙 1). 색은 variant 가 단독 소유(§7.11 — BASE 에
  // 색을 두면 Tailwind 컴파일 순서상 variant 가 못 덮는다).
  'border ' +
  // duration = 모션 토큰(--dur-fast = 120ms) SSOT. focus-visible = border ink
  // + --focus-ring (하드 그림자로 포커스 표시 금지 — CD Interactions).
  'transition-colors duration-[var(--dur-fast)] focus:outline-none ' +
  'focus-visible:shadow-soft-focus-ring ' +
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:transform-none disabled:shadow-none';

// Soft tone — 원형 아이콘 버튼. ghost/ghost-danger/ghost-brand 는 같은 chrome
// (흰 면 + 1px --line)을 공유하고 hover 의 보더/글자색만 의도별로 다르다.
// `bordered` 는 그 중 가장 또렷한 중립(ink 글자).
const VARIANT: Record<IconButtonVariant, string> = {
  ghost:
    'rounded-pill border-soft-line bg-soft-surface text-ink shadow-none ' +
    'hover:border-soft-line-hover hover:bg-soft-surface-2',
  'ghost-danger':
    'rounded-pill border-soft-line bg-soft-surface text-soft-mute shadow-none ' +
    'hover:border-soft-danger hover:bg-soft-err-bg hover:text-soft-danger',
  'ghost-brand':
    'rounded-pill border-soft-line bg-soft-surface text-soft-mute shadow-none ' +
    'hover:border-soft-line-hover hover:bg-soft-fill hover:text-ink',
  bordered:
    'rounded-pill border-soft-line bg-soft-surface text-ink shadow-none ' +
    'hover:border-soft-line-hover hover:bg-soft-surface-2',
  // Subtle tone for header bands — 중립 칩(--fill), 선 없음. Button `subtle`
  // 과 한 가족.
  subtle:
    'rounded-pill border-transparent bg-soft-fill text-ink shadow-none ' +
    'hover:bg-soft-line',
  // Bare glyph — no box, background, or shadow at all; hover changes color
  // only (--mute → ink). §7.11: caller className cannot strip a variant's
  // border/bg via source order, so a dedicated variant is the only reliable
  // way to render an IconButton with zero chrome.
  plain:
    'border-transparent bg-transparent shadow-none text-soft-mute hover:text-ink',
};

const SIZE: Record<IconButtonSize, string> = {
  // inline-flex + centering + leading-none so callers that pass no padding
  // still render the glyph centered inside the bordered chrome (PR #466 gave
  // every variant a border; compact size had no inline placement so the glyph
  // sat off-box or clipped).
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
    // (padding 0.4rem 0.85rem · 굵은 보더 · radius 8px — 본문 영역은 2단계
    // 소유라 그대로 남아 있다) 에서 opt-out.
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
