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

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

const BASE =
  'bg-transparent py-0.5 text-lg text-ink-2 placeholder:text-mute-soft ' +
  'focus:outline-none ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const ChipInput = forwardRef<HTMLInputElement, Props>(function ChipInput(
  { className, ...rest },
  ref,
) {
  const cls = [BASE, className ?? ''].filter(Boolean).join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});
