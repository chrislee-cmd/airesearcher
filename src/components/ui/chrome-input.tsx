'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

// Shared <ChromeInput> primitive — codifies the recurring "4px-radius
// chrome" <input> pattern, paired with <ChromeButton>. Distinct from
// <Input> (14px capsule, form-styled) by design: chrome is squared and
// tight, intended for inline tool-row name/rename/URL fields.
//
// Audit observed 5 sites — workspace-panel project/folder name inputs
// (4) and translate-console share URL readonly (1).
//
// Sizes:
//   xs   px-1.5 py-0.5 text-[12px]   in-row chrome (workspace folder rename)
//   sm   px-2   py-1   text-[12px]   standalone chrome (workspace new project,
//                                    translate share URL)
//
// Layout: doesn't bake `flex-1`. Caller passes `className="flex-1"` (or
// other layout class) since the right answer depends on the parent.
//
// One-off styling (font-mono, lighter border, etc.) is left to
// className — see translate-console share URL using `border-line-soft
// font-mono` as className override.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: 'xs' | 'sm';
};

const BASE =
  'border border-line bg-paper text-ink-2 rounded-xs ' +
  'focus:outline-none focus-visible:border-amore ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const SIZE = {
  xs: 'px-1.5 py-0.5 text-[12px]',
  sm: 'px-2 py-1 text-[12px]',
};

export const ChromeInput = forwardRef<HTMLInputElement, Props>(function ChromeInput(
  { size = 'sm', className, ...rest },
  ref,
) {
  const cls = [BASE, SIZE[size], className ?? '']
    .filter(Boolean)
    .join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});
