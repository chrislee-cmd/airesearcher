'use client';

// Shared <Skeleton> primitive — replaces ad-hoc animate-pulse fragments
// observed in 2026-05-31 audit. Three visual modes cover the common
// cases: line of text, block (card/row), circle (avatar/chip).
//
// Status: NOT YET CONSUMED. Migrations land in follow-up PRs.

type Variant = 'text' | 'block' | 'circle';

type Props = {
  variant?: Variant;
  width?: string | number;
  height?: string | number;
  className?: string;
};

function toSize(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

export function Skeleton({
  variant = 'block',
  width,
  height,
  className,
}: Props) {
  const radius =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'text'
        ? 'rounded-xs'
        : 'rounded-sm';

  const defaults =
    variant === 'text'
      ? 'h-3 w-full'
      : variant === 'circle'
        ? 'h-8 w-8'
        : 'h-6 w-full';

  const cls = [
    'inline-block animate-pulse bg-line-soft',
    radius,
    defaults,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      aria-hidden="true"
      className={cls}
      style={{
        width: toSize(width),
        height: toSize(height),
      }}
    />
  );
}
