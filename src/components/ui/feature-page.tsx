import type { ReactNode } from 'react';

type FeaturePageProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
};

export function FeaturePage({
  title,
  subtitle,
  headerRight,
  children,
}: FeaturePageProps) {
  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {headerRight ? (
          <div className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
            {headerRight}
          </div>
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
