'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Label } from './label';

// Shared <Input> primitive — codifies the recurring native <input>
// pattern (85 sites observed in 2026-05-31 audit).
//
// Status: NOT YET CONSUMED. Page-by-page migration in follow-up PRs.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  size?: 'sm' | 'md';
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  fullWidth?: boolean;
};

const SIZE = {
  sm: 'px-2.5 py-1.5 text-[12px]',
  md: 'px-3 py-2 text-[13px]',
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    label,
    helper,
    error,
    size = 'md',
    leftSlot,
    rightSlot,
    fullWidth = true,
    className,
    id,
    required,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const inputCls = [
    'border bg-paper text-ink placeholder:text-mute-soft',
    'focus:outline-none focus-visible:border-amore',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    'rounded-sm',
    fullWidth ? 'w-full' : '',
    error ? 'border-warning focus:border-warning' : 'border-line focus:border-ink',
    SIZE[size],
    leftSlot ? 'pl-8' : '',
    rightSlot ? 'pr-8' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={fullWidth ? 'w-full' : 'inline-block'}>
      {label ? (
        <Label htmlFor={inputId} required={required} className="mb-1.5">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        {leftSlot ? (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute-soft">
            {leftSlot}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helper
                ? `${inputId}-helper`
                : undefined
          }
          className={inputCls}
          {...rest}
        />
        {rightSlot ? (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mute-soft">
            {rightSlot}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-[11px] text-warning">
          {error}
        </p>
      ) : helper ? (
        <p id={`${inputId}-helper`} className="mt-1 text-[11px] text-mute-soft">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
