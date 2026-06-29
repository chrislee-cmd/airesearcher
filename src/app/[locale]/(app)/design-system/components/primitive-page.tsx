'use client';

import type { ReactNode } from 'react';

export function PrimitivePage({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-6 border-b border-line-soft pb-3">
        <h2 className="text-3xl font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {hint ? <p className="mt-1.5 text-sm text-mute-soft">{hint}</p> : null}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Subsection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="eyebrow-mute mb-2">{label}</div>
      {children}
    </div>
  );
}
