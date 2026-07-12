'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>;

export const Slider = forwardRef<HTMLInputElement, Props>(function Slider(
  { className, ...rest },
  ref,
) {
  const cls = [
    'h-1 w-full cursor-pointer appearance-none bg-line-soft accent-amore rounded-2xs',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <input
      ref={ref}
      type="range"
      className={cls}
      {...rest}
      data-ds-primitive="Slider"
    />
  );
});
