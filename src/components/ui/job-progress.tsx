'use client';

import type { ReactNode } from 'react';

type Tone = 'default' | 'error';

type Props = {
  value?: number;
  label: string;
  hint?: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  tone?: Tone;
};

export function JobProgress({
  value,
  label,
  hint,
  onCancel,
  cancelLabel = 'STOP',
  tone = 'default',
}: Props) {
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.max(0, Math.min(100, value)) : 0;
  const fillTone = tone === 'error' ? 'bg-warning' : 'bg-amore';
  const labelTone = tone === 'error' ? 'text-warning' : 'text-amore';

  return (
    <div className="border border-line bg-paper-soft px-4 py-3 rounded-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 animate-pulse rounded-full ${
              tone === 'error' ? 'bg-warning' : 'bg-amore'
            }`}
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
            <button
              type="button"
              onClick={onCancel}
              className="border border-line bg-paper px-2.5 py-1 text-xs-soft font-semibold uppercase tracking-[.18em] text-mute hover:border-warning hover:text-warning rounded-sm"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
        className="mt-2 h-1 w-full overflow-hidden bg-line-soft rounded-full"
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
