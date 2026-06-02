'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

// Shared <Checkbox> primitive — codifies the recurring native
// <input type="checkbox"> pattern (6 sites observed across desk /
// translate / workspace / recruiting / credits).
//
// All existing sites share the amore brand accent — the primitive bakes
// it in so callers don't need to remember `accent-amore`. Size defaults
// to `sm` (h-3 w-3) which matches all current usage; `md` is reserved
// for future denser forms.
//
// Usage: wrap with a <label> for click target and screen-reader text,
// or pass aria-label / aria-labelledby for icon-only contexts.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  size?: 'sm' | 'md';
};

const SIZE = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
};

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { size = 'sm', className, ...rest },
  ref,
) {
  const cls = ['accent-amore', SIZE[size], className ?? '']
    .filter(Boolean)
    .join(' ');
  return <input ref={ref} type="checkbox" className={cls} {...rest} />;
});
