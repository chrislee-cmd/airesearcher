'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

type Tone = 'default' | 'error';

type Props = {
  value?: number;
  label: string;
  hint?: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  tone?: Tone;
  variant?: 'card' | 'inline';
};

export function JobProgress({
  value,
  label,
  hint,
  onCancel,
  cancelLabel = 'STOP',
  tone = 'default',
  variant = 'card',
}: Props) {
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.max(0, Math.min(100, value)) : 0;
  const isError = tone === 'error';
  const fillTone = isError ? 'bg-warning' : 'bg-ink';
  const labelTone = isError ? 'text-warning' : 'text-ink';
  const dotTone = isError ? 'bg-warning' : 'bg-ink';
  const containerTone = isError
    ? 'border-warning shadow-[3px_3px_0_var(--color-warning)]'
    : 'border-ink shadow-[3px_3px_0_black]';

  // inline: outer border/shadow/bg 제거 — 이미 border 컨테이너 (예:
  // WidgetOutputRow) 안에서 mount 될 때 이중 컨테이너 시각을 피함. padding 만 최소.
  const containerCls =
    variant === 'inline'
      ? 'px-1 py-2'
      : `border-[2px] bg-paper px-4 py-3 rounded-sm ${containerTone}`;

  return (
    <div className={containerCls}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full ${dotTone}`}
          />
          <span
            className={`truncate text-xs-soft font-semibold uppercase tracking-[0.22em] ${labelTone}`}
          >
            {label}
          </span>
          {determinate && (
            <span className="tabular-nums text-sm text-mute-soft">
              {Math.round(pct)}%
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hint && (
            <span className="text-sm tabular-nums text-mute-soft">
              {hint}
            </span>
          )}
          {onCancel && (
            <Button variant="destructive" size="xs" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
        className="mt-2 h-1 w-full overflow-hidden bg-paper-soft rounded-full"
      >
        {determinate ? (
          <div
            className={`h-full ${fillTone} transition-[width] duration-[240ms]`}
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div
            className={`h-full w-1/3 ${fillTone} job-progress-indeterminate`}
          />
        )}
      </div>
    </div>
  );
}
