'use client';

import { useMemo, useState } from 'react';
import { addDays, fromIso, startOfMonth, startOfWeek, toIso } from '@/lib/scheduler/slots';
import type { IsoDate } from '@/lib/scheduler/types';

type Props = {
  start: IsoDate;
  end: IsoDate;
  weekdayShort: string[];
  onChange: (next: { start: IsoDate; end: IsoDate }) => void;
};

export function DateRangeCalendar({ start, end, weekdayShort, onChange }: Props) {
  const [cursor, setCursor] = useState<Date>(() => {
    if (start) return startOfMonth(fromIso(start));
    return startOfMonth(new Date());
  });

  const cells = useMemo(() => {
    const gridStart = startOfWeek(cursor);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  function shiftMonth(dir: -1 | 1) {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + dir);
    setCursor(d);
  }

  function pick(iso: IsoDate) {
    if (!start || (start && end)) {
      onChange({ start: iso, end: '' });
      return;
    }
    if (iso < start) {
      onChange({ start: iso, end: start });
      return;
    }
    onChange({ start, end: iso });
  }

  const monthLabel = `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="border border-line [border-radius:4px]">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
        <button type="button" onClick={() => shiftMonth(-1)} className={navBtn}>‹</button>
        <span className="text-[12.5px] tabular-nums text-ink-2">{monthLabel}</span>
        <button type="button" onClick={() => shiftMonth(1)} className={navBtn}>›</button>
      </div>
      <div className="grid grid-cols-7 border-b border-line-soft">
        {weekdayShort.map((w) => (
          <div key={w} className="py-1 text-center text-[10.5px] uppercase tracking-[0.06em] text-mute-soft">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const iso = toIso(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isStart = iso === start;
          const isEnd = iso === end;
          const inRange = start && end && iso > start && iso < end;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => pick(iso)}
              className={
                'h-8 text-[11.5px] tabular-nums transition-colors ' +
                (isStart || isEnd
                  ? 'bg-ink text-paper'
                  : inRange
                    ? 'bg-amore/15 text-ink-2'
                    : inMonth
                      ? 'text-ink-2 hover:bg-amore/10'
                      : 'text-mute-soft hover:bg-paper-soft')
              }
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const navBtn =
  'border border-line bg-paper px-2 py-0.5 text-[12px] text-ink-2 hover:border-ink [border-radius:4px]';
