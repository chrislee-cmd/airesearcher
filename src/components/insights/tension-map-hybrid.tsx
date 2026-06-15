'use client';

import { useMemo } from 'react';
import type { TensionWithQuotes } from '@/lib/insights-qualitative-load';
import { TensionList } from './tension-list';

// Variant C — hybrid. Top: compact strip overview (per-axis, all
// participants at once, no interaction). Bottom: full paired-quote card
// list (the variant B). The overview is for "where do people sit on the
// big tension axes" at a glance; the cards are for the quote-level
// search-first reading the user prioritizes.
type AxisGroup = {
  axis: string;
  rows: TensionWithQuotes[];
};

function groupByAxis(tensions: TensionWithQuotes[]): AxisGroup[] {
  const map = new Map<string, TensionWithQuotes[]>();
  for (const t of tensions) {
    const arr = map.get(t.axis) ?? [];
    arr.push(t);
    map.set(t.axis, arr);
  }
  return Array.from(map.entries())
    .map(([axis, rows]) => ({ axis, rows }))
    .sort((a, b) => a.axis.localeCompare(b.axis, 'ko'));
}

function MiniRail({ group }: { group: AxisGroup }) {
  return (
    <div className="border border-line-soft bg-paper p-3 rounded-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11.5px] font-semibold text-ink-2">{group.axis}</h4>
        <span className="text-[10.5px] tabular-nums text-mute-soft">
          {group.rows.length}명
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-mute-soft">
        <span>lo</span>
        <span>hi</span>
      </div>
      <div className="relative mt-0.5 h-5">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-soft" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line" />
        {group.rows.map((r) => {
          const signed = r.hi_val - r.lo_val;
          const pct = ((signed + 1) / 2) * 100;
          return (
            <span
              key={r.id}
              title={`${r.participant_name} · lo ${(r.lo_val * 100).toFixed(0)}% / hi ${(r.hi_val * 100).toFixed(0)}%`}
              className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 border border-amore bg-amore rounded-full"
              style={{ left: `${pct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function TensionMapHybrid({
  tensions,
}: {
  tensions: TensionWithQuotes[];
}) {
  const groups = useMemo(() => groupByAxis(tensions), [tensions]);
  if (groups.length === 0) {
    return (
      <p className="text-[11.5px] leading-[1.55] text-mute-soft">
        이 분석에는 긴장 데이터가 없습니다.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow-mute mb-2">개요</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <MiniRail key={g.axis} group={g} />
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow-mute mb-2">상세</div>
        <TensionList tensions={tensions} />
      </div>
    </div>
  );
}
