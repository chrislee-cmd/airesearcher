'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Label } from './label';

// Shared <Input> primitive — codifies the recurring native <input>
// pattern (85 sites observed in 2026-05-31 audit).
//
// **Soft Identity 리브랜드 1단계** — 변환표 "입력/피커 트리거: border 1 `--line`
// · radius 10 · focus = border ink + `--focus-ring`"(기존 border 1 line(ink/10)
// · radius 14 · focus border amore). 패딩·폰트·에러 shake 등은 불변.

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
  sm: 'px-2.5 py-1.5 text-md',
  md: 'px-3 py-2 text-lg',
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

  // Wave3 주의 환기 — 에러가 없다가 생기는 순간(false→true)에만 shake 1회.
  // .shake 는 globals.css 에서 reduced-motion 을 독립 존중(무애니메이션). 색은
  // --err-line transition(transition-colors)으로 error 톤이 부드럽게 전환.
  const hasError = Boolean(error);
  const prevError = useRef(hasError);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (hasError && !prevError.current) {
      setShaking(true);
      const t = window.setTimeout(() => setShaking(false), 300);
      prevError.current = hasError;
      return () => window.clearTimeout(t);
    }
    prevError.current = hasError;
  }, [hasError]);

  const inputCls = [
    'border bg-soft-surface text-ink placeholder:text-soft-faint transition-colors',
    // focus = border ink + --focus-ring (하드 그림자로 포커스 표시 금지).
    'focus:outline-none focus-visible:border-ink focus-visible:shadow-soft-focus-ring',
    'disabled:bg-soft-fill disabled:text-soft-disabled disabled:cursor-not-allowed',
    'rounded-control',
    fullWidth ? 'w-full' : '',
    error
      ? 'border-soft-err-line focus:border-soft-err-dot'
      : 'border-soft-line focus:border-ink',
    shaking ? 'shake' : '',
    SIZE[size],
    leftSlot ? 'pl-8' : '',
    rightSlot ? 'pr-8' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={fullWidth ? 'w-full' : 'inline-block'}
      data-ds-primitive="Input"
    >
      {label ? (
        <Label htmlFor={inputId} required={required} className="mb-1.5">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        {leftSlot ? (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-soft-faint">
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
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-soft-faint">
            {rightSlot}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-soft-err-fg">
          {error}
        </p>
      ) : helper ? (
        <p id={`${inputId}-helper`} className="mt-1 text-sm text-soft-mute">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
