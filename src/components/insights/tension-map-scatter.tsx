'use client';

import { useMemo, useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import type { TensionWithQuotes } from '@/lib/insights-qualitative-load';

// Variant A — 1D strip per axis.
// Group tensions by axis. For each axis, draw a horizontal rail from
// "lo" (-1) to "hi" (+1). A participant sits at signed = hi_val - lo_val
// (positive = leans hi, negative = leans lo, 0 = balanced tension).
// Click a dot to reveal both anchor quotes below the rail.
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

function AxisRail({ group }: { group: AxisGroup }) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRow = useMemo(
    () => group.rows.find((r) => r.id === selected) ?? null,
    [group.rows, selected],
  );

  return (
    <div className="border border-line bg-paper p-4 rounded-sm">
      <h3 className="text-[13.5px] font-semibold text-ink-2">{group.axis}</h3>
      <div className="mt-3 flex items-center justify-between text-[10.5px] uppercase tracking-wide text-mute-soft">
        <span>lo</span>
        <span>hi</span>
      </div>
      <div className="relative mt-1 h-9">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-soft" />
        <div className="absolute left-1/2 top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-line" />
        {group.rows.map((r) => {
          const signed = r.hi_val - r.lo_val; // [-1, 1]
          const pct = ((signed + 1) / 2) * 100;
          const isSelected = r.id === selected;
          return (
            <IconButton
              key={r.id}
              aria-label={`${r.participant_name} on ${group.axis}`}
              title={r.participant_name}
              variant="ghost"
              size="compact"
              onClick={() => setSelected(isSelected ? null : r.id)}
              className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 border rounded-full ${
                isSelected
                  ? 'border-amore bg-amore'
                  : 'border-line bg-paper hover:border-amore'
              }`}
              style={{ left: `${pct}%` }}
            >
              <span className="sr-only">{r.participant_name}</span>
            </IconButton>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {group.rows.map((r) => {
          const isSelected = r.id === selected;
          return (
            <IconButton
              key={`legend-${r.id}`}
              aria-label={`Select ${r.participant_name}`}
              variant="ghost"
              size="compact"
              onClick={() => setSelected(isSelected ? null : r.id)}
              className={`border px-1.5 py-0.5 text-[10.5px] tabular-nums rounded-xs transition ${
                isSelected
                  ? 'border-amore text-amore'
                  : 'border-line-soft text-mute-soft hover:border-amore hover:text-amore'
              }`}
            >
              {r.participant_name}
            </IconButton>
          );
        })}
      </div>
      {selectedRow && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="border border-line-soft bg-paper p-3 rounded-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow-mute">lo</span>
              <span className="text-[10.5px] tabular-nums text-mute-soft">
                {(selectedRow.lo_val * 100).toFixed(0)}%
              </span>
            </div>
            {selectedRow.lo_quote ? (
              <p className="mt-1.5 text-[12px] leading-[1.55] text-ink-2">
                {selectedRow.lo_quote.text}
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] italic text-mute-soft">
                인용구 누락
              </p>
            )}
          </div>
          <div className="border border-line-soft bg-paper p-3 rounded-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow-mute">hi</span>
              <span className="text-[10.5px] tabular-nums text-mute-soft">
                {(selectedRow.hi_val * 100).toFixed(0)}%
              </span>
            </div>
            {selectedRow.hi_quote ? (
              <p className="mt-1.5 text-[12px] leading-[1.55] text-ink-2">
                {selectedRow.hi_quote.text}
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] italic text-mute-soft">
                인용구 누락
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TensionMapScatter({
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
    <div className="space-y-3">
      {groups.map((g) => (
        <AxisRail key={g.axis} group={g} />
      ))}
    </div>
  );
}
