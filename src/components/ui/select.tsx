'use client';

import {
  forwardRef,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Label } from './label';

// Shared <Select> primitive — codifies the recurring native <select>
// pattern. Mirrors <Input>: same label/helper/error/size/fullWidth contract,
// same focus-visible:border-amore + aria-invalid wiring. Native <select>
// stays under the hood for free keyboard + a11y; appearance-none hides the
// browser chevron and we draw our own on the right so it matches the
// editorial 1px-border look.
//
// Status: NOT YET CONSUMED. Page-by-page migration in follow-up PRs.

type Option = { value: string; label: string; disabled?: boolean };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  label?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  size?: 'sm' | 'md';
  leftSlot?: ReactNode;
  fullWidth?: boolean;
  placeholder?: string;
  options?: Option[];
};

const SIZE = {
  sm: 'px-2.5 py-1.5 text-md',
  md: 'px-3 py-2 text-lg',
};

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  {
    label,
    helper,
    error,
    size = 'md',
    leftSlot,
    fullWidth = true,
    placeholder,
    options,
    children,
    className,
    id,
    required,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;

  const selectCls = [
    'appearance-none border bg-paper text-ink',
    'focus:outline-none focus-visible:border-amore',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    'rounded-sm',
    fullWidth ? 'w-full' : '',
    error
      ? 'border-warning focus:border-warning'
      : 'border-line focus:border-ink',
    SIZE[size],
    leftSlot ? 'pl-8' : '',
    'pr-8',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={fullWidth ? 'w-full' : 'inline-block'}
      data-ds-primitive="Select"
    >
      {label ? (
        <Label htmlFor={selectId} required={required} className="mb-1.5">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        {leftSlot ? (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute-soft">
            {leftSlot}
          </span>
        ) : null}
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error
              ? `${selectId}-error`
              : helper
                ? `${selectId}-helper`
                : undefined
          }
          className={selectCls}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {options
            ? options.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mute-soft"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
      {error ? (
        <p id={`${selectId}-error`} className="mt-1 text-sm text-warning">
          {error}
        </p>
      ) : helper ? (
        <p id={`${selectId}-helper`} className="mt-1 text-sm text-mute-soft">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
