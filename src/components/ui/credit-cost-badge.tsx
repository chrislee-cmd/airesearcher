import type { ReactNode } from 'react';

type Tone = 'default' | 'warning' | 'subtle';

type Props = {
  cost: number;
  unitLabel?: string;
  tone?: Tone;
  prefix?: ReactNode;
  className?: string;
};

const TONE_CLASS: Record<Tone, string> = {
  default: 'border-line text-mute-soft',
  warning: 'border-warning-line text-warning',
  subtle: 'border-line-soft text-mute-soft',
};

export function CreditCostBadge({
  cost,
  unitLabel = 'credits',
  tone = 'default',
  prefix,
  className,
}: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] tabular-nums [border-radius:2px] ${TONE_CLASS[tone]}${
        className ? ` ${className}` : ''
      }`}
    >
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      <span>{cost.toLocaleString()}</span>
      <span>{unitLabel}</span>
    </span>
  );
}
