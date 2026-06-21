/* ────────────────────────────────────────────────────────────────────
   Canvas shell primitives — 도메인 X 인 작은 UI 부품.
   Section / Label / Pill. WidgetShell 헤더 + 위젯 본문에서 공용.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.22em] text-mute-soft">
        {label}
      </div>
      {children}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.22em] text-mute-soft">
      {children}
    </div>
  );
}

export function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs ${cls}`}
    >
      {label}
    </span>
  );
}
