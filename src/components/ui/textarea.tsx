'use client';

import { forwardRef, useId, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { Label } from './label';

// Shared <Textarea> primitive — same look + a11y wiring as <Input>,
// just multi-line.

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  fullWidth?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  {
    label,
    helper,
    error,
    fullWidth = true,
    className,
    id,
    required,
    rows = 4,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const taCls = [
    'border bg-paper px-3 py-2 text-[13px] leading-[1.6] text-ink placeholder:text-mute-soft',
    'focus:outline-none focus-visible:border-amore',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    '[border-radius:14px]',
    'resize-y',
    fullWidth ? 'w-full' : '',
    error ? 'border-warning focus:border-warning' : 'border-line focus:border-ink',
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
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error
            ? `${inputId}-error`
            : helper
              ? `${inputId}-helper`
              : undefined
        }
        className={taCls}
        {...rest}
      />
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
