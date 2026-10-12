'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

// Shared <CloseButton> primitive — the single close/remove/dismiss/clear
// control for the whole product. Consolidates the "✕ in a hand-styled box"
// pattern that was scattered across ~39 sites (modal headers, list-row
// removes, filter-chip clears, toast/banner dismisses), each with its own
// hardcoded grey border / radius / hit-area.
//
// CD SSOT: design-handoff/close-button-upload-modal/from-cd/
//   close-button-BUILD-SPEC.md §1 (variant token table) +
//   CLOSE-BUTTON-AUDIT.dc.html (variant×state visual oracle).
//
// HARD RULE (§0-1 / DESIGN-SSOT-MASTER §D5): the `✕` **character** stays a
// character — NOT an SVG icon. We never touch iconography-duotone for close.
// Only the box around the glyph (size · border · radius · colour · hover) is
// what this primitive standardises.
//
// The four variants split on two axes only (§0-2):
//   ① destructive? (discards something)   → row-remove, chip-clear get --danger hover
//   ② hit-area / glyph size                → 16 / 24 / 28 / 32 (치수 불변)
//   (Soft 전환 후에는 어느 variant 도 idle 보더를 들지 않는다 — 핵심규칙 1/2.)
//
//   row-remove     28×28 · pill · borderless idle → --danger on hover.
//                  Lives inside list/attachment rows; quiet until hovered.
//   dialog-close   32×32 · pill · borderless idle (Soft 변환표 "닫기 38 원 —
//                  ✕ 1.8 스트로크 --mute, **테두리 없음**"), --fill on hover.
//                  Modal/sheet header, no surrounding frame.
//   chip-clear     16×16 · pill · glyph only, --danger on hover. Inside a chip
//                  that is already a bordered box (28-px min-hit exemption —
//                  the whole chip is the target).
//   banner-dismiss 24×24 · pill · borderless, --fill hover, NON-destructive so
//                  no danger tint (24-px min-hit exemption — reversible).
//
// **Soft Identity 리브랜드 1단계** — 변환표 + 핵심규칙 1/2/5 적용:
// 모든 variant 가 pill(원형) · 테두리 없음 · 그림자 0 · hover 는 색만.
// Colour mapping (CD Soft token → util):
//   --mute   #6e6a75  → text-soft-mute      (✕ 글리프 기본)
//   --danger #c2334f  → text-soft-danger    (파괴 hover)
//   --err-bg #fdf0f0  → bg-soft-err-bg      (파괴 hover 면)
//   --fill   #f4f3f6  → bg-soft-fill        (중립 hover 면)
//   --ink    #1d1b20  → text-ink
// --focus-ring 는 1단계에서 등재돼 focus-visible:shadow-soft-focus-ring 로 소비.
//
// REQUIRED: aria-label. Icon-only controls are unusable by screen readers
// without one, so the type forces callers to pass it.

export type CloseButtonVariant =
  | 'row-remove'
  | 'dialog-close'
  | 'chip-clear'
  | 'banner-dismiss';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  variant?: CloseButtonVariant;
};

// Common chrome (§1 header): the ✕ glyph is 700 weight, line-height 1, flex
// centred. Transition covers only background/border/colour/shadow at
// --dur-fast (=120ms, the CD-specified .12s). reduced-motion kills it.
// disabled = mute text, no shadow, and pointer-events-none so the hover
// treatment can't fire — opacity is explicitly forbidden (§3 disabled row).
const BASE =
  'inline-flex items-center justify-center font-bold leading-none select-none ' +
  'transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-fast)] ' +
  'motion-reduce:transition-none ' +
  'focus:outline-none focus-visible:shadow-soft-focus-ring ' +
  'disabled:text-soft-disabled disabled:shadow-none disabled:pointer-events-none';

// Per §7.11: a variant owns its colour/border/shadow so caller className can
// never strip it via CSS source order. 치수(h/w)는 전부 불변 — radius·색·선·
// 그림자만 Soft 로 교체.
const VARIANT: Record<CloseButtonVariant, string> = {
  // Destructive · borderless idle → --danger on hover.
  'row-remove':
    'h-7 w-7 rounded-pill text-xl ' +
    'border border-transparent bg-transparent text-soft-mute ' +
    'hover:bg-soft-err-bg hover:text-soft-danger',
  // 모달/시트 헤더의 닫기 — Soft 에서는 테두리도 그림자도 없는 원형이다
  // (변환표 "닫기 38 원 · ✕ 1.8 스트로크 --mute · 테두리 없음").
  // Non-destructive (folds a surface) 라 danger 틴트 없음.
  'dialog-close':
    'h-8 w-8 rounded-pill text-2xl ' +
    'border border-transparent bg-transparent text-soft-mute shadow-none ' +
    'hover:bg-soft-fill hover:text-ink',
  // Destructive · glyph only (chip is already the box). 16-px exemption.
  'chip-clear':
    'h-4 w-4 rounded-pill text-sm ' +
    'border-transparent bg-transparent text-soft-mute ' +
    'hover:text-soft-danger',
  // Non-destructive dismiss: borderless, 중립 --fill wash on hover.
  // 24-px exemption (low banner, reversible) — no danger tint.
  'banner-dismiss':
    'h-6 w-6 rounded-pill text-lg ' +
    'border-transparent bg-transparent text-soft-mute ' +
    'hover:bg-soft-fill hover:text-ink',
};

export const CloseButton = forwardRef<HTMLButtonElement, Props>(function CloseButton(
  { variant = 'row-remove', className, type = 'button', ...rest },
  ref,
) {
  const cls = [BASE, VARIANT[variant], className ?? ''].filter(Boolean).join(' ');

  return (
    // data-canvas-action opts out of the [data-canvas-body] button cascade
    // (padding/border override that would eat the fixed hit-area inside canvas
    // widgets — same guard IconButton uses).
    <button
      ref={ref}
      type={type}
      className={cls}
      data-canvas-action
      {...rest}
      data-ds-primitive="CloseButton"
    >
      {/* ✕ stays a character (U+2715), never an SVG — §0-1 / §D5. */}
      <span aria-hidden="true">✕</span>
    </button>
  );
});
