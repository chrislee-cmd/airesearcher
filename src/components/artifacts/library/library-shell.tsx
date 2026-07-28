import type { ReactNode } from 'react';

// Presentational frame for Surface A — frame + header chrome + (rail | main)
// body. Feature-blind: it only lays out slots. Geometry (GEOMETRY §A): 3px ink
// frame · radius 16 (rounded-panel-lg) · shadow-frame · surface-canvas bg;
// header border-b 3px; the 1560×880 outer box is container-owned (fills the
// in-app surface, responsive).

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

export function LibraryShell({
  title,
  count,
  search,
  sort,
  view,
  rail,
  children,
}: {
  title: string;
  count: number;
  search: ReactNode;
  sort: ReactNode;
  view: ReactNode;
  rail: ReactNode;
  children: ReactNode; // the list/grid column (owns its own scroll + footer)
}) {
  return (
    <div className="flex h-full min-h-[640px] w-full flex-col overflow-hidden rounded-panel-lg border-[3px] border-ink bg-surface-canvas shadow-frame">
      <div className="flex shrink-0 items-center gap-3 border-b-[3px] border-ink bg-paper px-6 py-4">
        <div className="flex shrink-0 items-baseline gap-2.5">
          <span className="text-3xl font-extrabold tracking-tight text-ink" style={OUTFIT}>
            {title}
          </span>
          <span className="font-mono-label text-md font-bold text-mute-soft">{count}</span>
        </div>
        {search}
        <div className="flex-1" />
        {sort}
        {view}
      </div>
      <div className="flex min-h-0 flex-1">
        {rail}
        {children}
      </div>
    </div>
  );
}
