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

  // resize: base defaults to vertical, but callers can override via className
  // (e.g. `resize-none`). Tailwind v4 resolves resize utilities by compiled
  // CSS source order — `.resize-y` in base would otherwise beat a caller's
  // `.resize-none` regardless of className order (§7.11 base-owns-override
  // trap). Guard: only emit the default when no resize util is present.
  const hasResizeUtil = /(?:^|\s)resize(?:-(?:none|x|y))?(?=\s|$)/.test(
    className ?? '',
  );

  const taCls = [
    'border bg-paper px-3 py-2 text-lg leading-[1.6] text-ink placeholder:text-mute-soft',
    'focus:outline-none focus-visible:border-amore',
    'disabled:opacity-40 disabled:cursor-not-allowed',
    'rounded-sm',
    hasResizeUtil ? '' : 'resize-y',
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
        <p id={`${inputId}-error`} className="mt-1 text-sm text-warning">
          {error}
        </p>
      ) : helper ? (
        <p id={`${inputId}-helper`} className="mt-1 text-sm text-mute-soft">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
