import type { ReactNode } from 'react';

export function Eyebrow({
  children,
  className = '',
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span className={`${muted ? 'eyebrow-mute' : 'eyebrow'} ${className}`}>
      {children}
    </span>
  );
}

export function ChapterHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="border-b border-line pb-3 text-[24px] font-bold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {description}
        </p>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  caption,
}: {
  label: string;
  value: string | number;
  unit?: string;
  caption?: string;
}) {
  return (
    <div className="border border-line bg-paper p-[18px] [border-radius:4px] border-t-2 border-t-amore">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[42px] font-bold leading-none tracking-[-0.01em] text-ink">
          {value}
        </span>
        {unit && <span className="text-[13px] text-mute">{unit}</span>}
      </div>
      {caption && <div className="mt-1.5 text-[13px] text-mute">{caption}</div>}
    </div>
  );
}
