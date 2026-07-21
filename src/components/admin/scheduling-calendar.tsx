'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { type SchedSlot, type SlotStatus } from '@/lib/scheduling/slots';

// Self-built lightweight time grid (no calendar library — keeps the bundle
// small and lets every pixel use design tokens). Week view = 7 day columns,
// day view = 1. Slots are stored UTC and rendered in the admin's local
// timezone. Clicking an empty half-hour opens the create modal pre-filled with
// that time; clicking a slot opens the edit modal.

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 21;
const PX_PER_MIN = 0.8;
const SNAP_MIN = 30;

const DAY_START_MIN = DAY_START_HOUR * 60;
const DAY_END_MIN = DAY_END_HOUR * 60;
const SPAN_MIN = DAY_END_MIN - DAY_START_MIN;
const DAY_HEIGHT = SPAN_MIN * PX_PER_MIN;

export type CalendarView = 'week' | 'day';

type Props = {
  slots: SchedSlot[];
  candidateName: (candidateId: string) => string;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  // Create a slot starting at the given local Date (end defaults to +30m).
  onCreateAt: (start: Date) => void;
  onEditSlot: (slot: SchedSlot) => void;
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// Sunday-start week containing `d`.
function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  return addDays(c, -c.getDay());
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Status → block/dot styling. Token-only (§9): amore for proposed, success for
// confirmed, muted+strikethrough for cancelled.
function blockClass(status: SlotStatus): string {
  switch (status) {
    case 'confirmed':
      return 'border-success bg-paper-soft text-ink';
    case 'cancelled':
      return 'border-line-soft bg-paper text-mute-soft line-through';
    default:
      return 'border-amore-soft bg-amore-bg text-ink';
  }
}

function dotClass(status: SlotStatus): string {
  switch (status) {
    case 'confirmed':
      return 'bg-success';
    case 'cancelled':
      return 'bg-mute-soft';
    default:
      return 'bg-amore';
  }
}

export function SchedulingCalendar({
  slots,
  candidateName,
  view,
  onViewChange,
  onCreateAt,
  onEditSlot,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  // Block label: free-text title wins (PR-B); otherwise the attached
  // candidate's name; a titleless candidate-less event falls back to a dash.
  function slotLabel(s: SchedSlot): string {
    const title = s.title?.trim();
    if (title) return title;
    if (s.candidate_id) return candidateName(s.candidate_id);
    return t('slotUntitled');
  }

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(anchor)];
    const wk = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  }, [anchor, view]);

  const hourLabels = useMemo(
    () =>
      Array.from(
        { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
        (_, i) => DAY_START_HOUR + i,
      ),
    [],
  );

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        weekday: 'short',
      }),
    [],
  );
  const rangeFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }),
    [],
  );
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );

  function shift(dir: -1 | 1) {
    setAnchor((a) => addDays(a, dir * (view === 'day' ? 1 : 7)));
  }

  function handleCellClick(day: Date, minutesFromStart: number) {
    const snapped = Math.floor(minutesFromStart / SNAP_MIN) * SNAP_MIN;
    const start = new Date(day);
    start.setHours(0, DAY_START_MIN + snapped, 0, 0);
    onCreateAt(start);
  }

  // Slots grouped by the local day they start on (keyed by date string).
  const slotsByDay = useMemo(() => {
    const map = new Map<string, SchedSlot[]>();
    for (const s of slots) {
      const d = new Date(s.start_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = startOfDay(d).toDateString();
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [slots]);

  const rangeLabel =
    view === 'day'
      ? dayFmt.format(days[0])
      : `${rangeFmt.format(days[0])} – ${rangeFmt.format(days[6])}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => shift(-1)}>
            ‹ {t('calPrev')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            {t('calToday')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => shift(1)}>
            {t('calNext')} ›
          </Button>
          <span className="ml-2 text-sm font-medium text-ink">{rangeLabel}</span>
        </div>
        <Tabs
          aria-label={t('calViewLabel')}
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
          items={[
            { value: 'week', label: t('calWeek') },
            { value: 'day', label: t('calDay') },
          ]}
        />
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[640px]">
          {/* Hour gutter */}
          <div className="w-14 shrink-0">
            <div className="h-8 border-b border-line" />
            <div className="relative" style={{ height: DAY_HEIGHT }}>
              {hourLabels.map((h, i) => (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-xs text-mute-soft"
                  style={{ top: i * 60 * PX_PER_MIN }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          <div className="flex flex-1">
            {days.map((day) => {
              const daySlots = slotsByDay.get(day.toDateString()) ?? [];
              const isToday = sameLocalDay(day, new Date());
              return (
                <div
                  key={day.toISOString()}
                  className="flex-1 border-l border-line first:border-l-0"
                >
                  <div
                    className={`flex h-8 items-center justify-center border-b border-line text-xs ${
                      isToday ? 'text-amore' : 'text-mute'
                    }`}
                  >
                    {dayFmt.format(day)}
                  </div>
                  <div className="relative" style={{ height: DAY_HEIGHT }}>
                    {/* Clickable half-hour grid */}
                    {Array.from({ length: SPAN_MIN / SNAP_MIN }, (_, r) => (
                      <div
                        key={r}
                        role="button"
                        tabIndex={-1}
                        onClick={() => handleCellClick(day, r * SNAP_MIN)}
                        className="absolute inset-x-0 cursor-pointer border-b border-line-soft hover:bg-paper-soft"
                        style={{
                          top: r * SNAP_MIN * PX_PER_MIN,
                          height: SNAP_MIN * PX_PER_MIN,
                        }}
                      />
                    ))}

                    {/* Slot blocks */}
                    {daySlots.map((s) => {
                      const start = new Date(s.start_at);
                      const end = new Date(s.end_at);
                      const startMin =
                        start.getHours() * 60 + start.getMinutes();
                      const endMin = end.getHours() * 60 + end.getMinutes();
                      const top =
                        Math.max(startMin - DAY_START_MIN, 0) * PX_PER_MIN;
                      const rawBottom =
                        Math.min(endMin - DAY_START_MIN, SPAN_MIN) * PX_PER_MIN;
                      const height = Math.max(rawBottom - top, 16);
                      return (
                        <div
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditSlot(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onEditSlot(s);
                            }
                          }}
                          className={`absolute inset-x-1 z-fab cursor-pointer overflow-hidden rounded-xs border px-1.5 py-1 text-left text-xs ${blockClass(
                            s.status,
                          )}`}
                          style={{ top, height }}
                          title={`${slotLabel(s)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`}
                        >
                          <span className="flex items-center gap-1 font-medium">
                            <span
                              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(
                                s.status,
                              )}`}
                            />
                            <span className="truncate">{slotLabel(s)}</span>
                          </span>
                          <span className="block truncate text-xs opacity-80">
                            {timeFmt.format(start)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amore" />
          {t('statusProposed')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-success" />
          {t('statusConfirmed')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-mute-soft" />
          {t('statusCancelled')}
        </span>
      </div>
    </div>
  );
}
