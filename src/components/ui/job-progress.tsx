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
  // Soft Identity (리브랜드 2단계) 진행 밴드 — 변환표 "진행 밴드" 행:
  // 위젯 톤 bg + border-t 2 ink → 공통 lav 틴트 면 + 1px run 선, 바 6px
  // --run-track/--run-dot, 상태 글자 --run-fg, 점은 --run-dot 깜빡임.
  // 실패는 같은 문법의 err 패밀리(틴트 면 + --err-line + --err-fg/-dot).
  const fillTone = isError ? 'bg-soft-err-dot' : 'bg-soft-run-dot';
  const trackTone = isError ? 'bg-soft-err-line' : 'bg-soft-run-track';
  const labelTone = isError ? 'text-soft-err-fg' : 'text-soft-run-fg';
  const dotTone = isError ? 'bg-soft-err-dot' : 'bg-soft-run-dot';
  const containerTone = isError
    ? 'border-soft-err-line bg-soft-err-bg'
    : 'border-soft-run-track bg-tint-lav';

  // inline: outer border/shadow/bg 제거 — 이미 border 컨테이너 (예:
  // WidgetOutputRow) 안에서 mount 될 때 이중 컨테이너 시각을 피함. padding 만 최소.
  const containerCls =
    variant === 'inline'
      ? 'px-1 py-2'
      : `border px-4 py-3 rounded-sm ${containerTone}`;

  return (
    <div className={containerCls} data-ds-primitive="JobProgress">
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
        className={`mt-2 h-1.5 w-full overflow-hidden rounded-full ${trackTone}`}
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
