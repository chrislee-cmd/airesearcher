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
//   ① destructive? (discards something)   → row-remove, chip-clear get crimson hover
//   ② already bordered by its surroundings? → only dialog-close carries its own border
//
//   row-remove     28×28 · r9   · borderless idle → crimson thin border on hover.
//                  Lives inside list/attachment rows; quiet until hovered.
//   dialog-close   32×32 · r9   · the ONLY variant with an idle border +
//                  faint hard shadow. Modal/sheet header, no surrounding frame.
//   chip-clear     16×16 · pill · glyph only, crimson on hover. Inside a chip
//                  that is already a bordered box (28-px min-hit exemption —
//                  the whole chip is the target).
//   banner-dismiss 24×24 · r9   · borderless, ink/6 hover, NON-destructive so
//                  no crimson (24-px min-hit exemption — low banner, reversible).
//
// Colour mapping (CD raw value → DS token, no raw hex so `check:design` stays 0):
//   #8a8693 mute-soft   → text-mute-soft
//   #c2334f crimson     → text/border-amore-deep
//   #fdf0f0 error.bg    → bg-error-bg
//   #1d1b20 ink         → text/border-ink
//   #fbfbf9 canvas      → bg-surface-canvas
//   #fff    paper       → bg-paper
//   2px2px0 ink/12      → shadow-memphis-sm-faint · 2px2px0 ink → shadow-memphis-sm
//
// PENDING TOKENS (BUILD-SPEC §2, do NOT add to globals.css here — CD to
// promote): --control-h-sm/md (28/32) and --focus-ring. Until --focus-ring
// lands we borrow IconButton's focus-visible:text-amore for consistency.
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
  'focus:outline-none focus-visible:text-amore ' +
  'disabled:text-mute disabled:shadow-none disabled:pointer-events-none';

// Per §7.11: a variant owns its colour/border/shadow so caller className can
// never strip it via CSS source order. Idle borders use border-transparent
// (reserving 1.5px) so the borderless→bordered hover adds no layout shift.
const VARIANT: Record<CloseButtonVariant, string> = {
  // Destructive · borderless idle → crimson on hover.
  'row-remove':
    'h-7 w-7 rounded-icon text-[15px] ' +
    'border-[1.5px] border-transparent bg-transparent text-mute-soft ' +
    'hover:bg-error-bg hover:border-amore-deep hover:text-amore-deep',
  // The only bordered idle variant: paper fill, ink border, faint hard shadow.
  // Non-destructive (folds a surface) so no crimson; active settles 1px in.
  'dialog-close':
    'h-8 w-8 rounded-icon text-[16px] ' +
    'border-[1.5px] border-ink bg-paper text-ink shadow-memphis-sm-faint ' +
    'hover:bg-surface-canvas hover:shadow-memphis-sm ' +
    'active:translate-x-px active:translate-y-px active:shadow-none',
  // Destructive · glyph only (chip is already the box). pill radius, 16-px
  // exemption. crimson on hover, never a background/border of its own.
  'chip-clear':
    'h-4 w-4 rounded-pill text-[11px] ' +
    'border-transparent bg-transparent text-mute-soft ' +
    'hover:text-amore-deep',
  // Non-destructive dismiss: borderless, soft ink wash on hover, ink glyph.
  // 24-px exemption (low banner, reversible) — no crimson.
  'banner-dismiss':
    'h-6 w-6 rounded-icon text-[13px] ' +
    'border-transparent bg-transparent text-mute-soft ' +
    'hover:bg-ink/6 hover:text-ink',
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
