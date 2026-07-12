import type { ReactNode } from 'react';

type Tone = 'default' | 'subtle';

export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = 'default',
  mascot = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  /** Wave3 delight — 아이콘 대신 브랜드 마스코트가 잔잔히 idle sway.
   *  opt-in(기본 off)이라 기존 empty 상태는 그대로. `icon` 이 있으면 icon 우선. */
  mascot?: boolean;
  className?: string;
}) {
  const container =
    tone === 'subtle'
      ? 'border-dashed border-line bg-paper-soft'
      : 'border-line bg-paper';

  return (
    <div
      className={`flex flex-col items-center justify-center border px-6 py-10 text-center rounded-sm ${container}${
        className ? ` ${className}` : ''
      }`}
      data-ds-primitive="EmptyState"
    >
      {icon ? (
        <div className="mb-3 text-mute-soft">{icon}</div>
      ) : mascot ? (
        // brand-sway 는 globals.css 에서 reduced-motion 시 정지(무모션 존중).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/branding/icons/03_ICON_FULL_COLOR.svg"
          alt=""
          width={44}
          height={44}
          className="brand-sway mb-3"
          style={{ width: 44, height: 44, objectFit: 'contain' }}
        />
      ) : null}
      <div className="text-md font-medium text-ink-2">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-[480px] text-sm leading-[1.6] text-mute-soft">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
