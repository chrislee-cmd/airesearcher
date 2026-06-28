'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

// Shared <ChipInput> primitive — codifies the "extender" <input> that
// lives inside a chip container (the bare text field where users type
// the next chip value). Distinct from <Input> (form-styled with its own
// wrapper div) and <ChromeInput> (4px chrome border): ChipInput
// intentionally has NO own border / background — those belong to the
// parent chip container's focus-within frame.
//
// Audit observed 1 site — desk-research keyword chip extender. New
// chip-style inputs (tag editors, multi-select drafts) should reuse
// this primitive rather than introducing another bare <input>.
//
// Layout: doesn't bake `flex-1` or min-width. Caller passes layout
// classes via className since the right values depend on the parent
// container.
//
// Cascade override: `[data-canvas-body] :is(input, ...)` in globals.css
// paints a 2px ink border + white bg + 6px radius + focus outline onto
// every bare <input> inside the canvas widget body. Without
// !important neutralization, the cascade wins over Tailwind utilities
// (attr+tag selector specificity beats class), drawing a second box
// stacked inside the parent's container frame. The `!*` prefixes below
// reclaim the bare-input contract.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

const BASE =
  '!border-0 !bg-transparent !rounded-none !shadow-none ' +
  '!px-0 !py-0.5 text-lg text-ink-2 placeholder:text-mute-soft ' +
  'focus:!outline-none ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const ChipInput = forwardRef<HTMLInputElement, Props>(function ChipInput(
  { className, ...rest },
  ref,
) {
  const cls = [BASE, className ?? ''].filter(Boolean).join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});
