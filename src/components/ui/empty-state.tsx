import type { ReactNode } from 'react';

type Tone = 'default' | 'subtle';

export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = 'default',
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const container =
    tone === 'subtle'
      ? 'border-dashed border-line bg-paper-soft'
      : 'border-line bg-paper';

  return (
    <div
      className={`flex flex-col items-center justify-center border px-6 py-10 text-center [border-radius:14px] ${container}${
        className ? ` ${className}` : ''
      }`}
    >
      {icon && <div className="mb-3 text-mute-soft">{icon}</div>}
      <div className="text-[12.5px] font-medium text-ink-2">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-[480px] text-[11.5px] leading-[1.6] text-mute-soft">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
