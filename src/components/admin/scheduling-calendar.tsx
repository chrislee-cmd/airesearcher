'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import { type SchedSlot, type SlotStatus } from '@/lib/scheduling/slots';

// Fresh Memphis rebuild (BUILD-SPEC §1 · CD frame 02). Self-built lightweight
// time grid — no calendar library, so every pixel binds a design token. Week
// view = 7 day columns, day view = 1. Slots are stored UTC, rendered in the
// admin's local timezone. Density = 80px/hour (§6.4). Clicking an empty
// half-hour opens the create modal pre-filled with that time; clicking a
// colored time-block opens the edit modal.

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 21;
// 80px per hour (BUILD-SPEC §6.4) — up from the legacy 0.8·56 density.
const PX_PER_HOUR = 80;
const PX_PER_MIN = PX_PER_HOUR / 60;
const SNAP_MIN = 30;
// Weekday-header / hour-gutter width (CD grid: 46px repeat(7,1fr)).
const GUTTER_W = 46;

const DAY_START_MIN = DAY_START_HOUR * 60;
const DAY_END_MIN = DAY_END_HOUR * 60;
const SPAN_MIN = DAY_END_MIN - DAY_START_MIN;
const DAY_HEIGHT = SPAN_MIN * PX_PER_MIN;

export type CalendarView = 'week' | 'day';

// Optional inline group-scope pill in the toolbar (CD frame 02 "Group: All ▾").
// The client owns the calendar's group filter state; the calendar just renders
// the control in the Memphis toolbar so the frame reads as one unit.
export type CalendarGroupFilter = {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
};

type Props = {
  slots: SchedSlot[];
  candidateName: (candidateId: string) => string;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  // Create a slot starting at the given local Date (end defaults to +30m).
  onCreateAt: (start: Date) => void;
  onEditSlot: (slot: SchedSlot) => void;
  groupFilter?: CalendarGroupFilter;
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

// Status → colored time-block skin (BUILD-SPEC §2 slot tokens). Token-only: the
// slot-* ramp (border/bg/dot) + the matching hard shadow CSS var. Cancelled adds
// a strike-through on the label.
const BLOCK: Record<
  SlotStatus,
  { block: string; dot: string; shadowVar: string; label: string }
> = {
  proposed: {
    block: 'border-slot-proposed-border bg-slot-proposed-bg',
    dot: 'bg-slot-proposed-dot',
    shadowVar: 'var(--slot-proposed-shadow)',
    label: 'text-ink',
  },
  confirmed: {
    block: 'border-slot-confirmed-border bg-slot-confirmed-bg',
    dot: 'bg-slot-confirmed-dot',
    shadowVar: 'var(--slot-confirmed-shadow)',
    label: 'text-ink',
  },
  cancelled: {
    block: 'border-slot-cancelled-border bg-slot-cancelled-bg',
    dot: 'bg-slot-cancelled-dot',
    shadowVar: 'var(--slot-cancelled-shadow)',
    label: 'text-mute-soft line-through',
  },
};

const OUTFIT = 'var(--font-outfit), var(--font-sans)';

export function SchedulingCalendar({
  slots,
  candidateName,
  view,
  onViewChange,
  onCreateAt,
  onEditSlot,
  groupFilter,
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
        { length: DAY_END_HOUR - DAY_START_HOUR },
        (_, i) => DAY_START_HOUR + i,
      ),
    [],
  );

  const dowFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
    [],
  );
  const rangeFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
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
      ? rangeFmt.format(days[0])
      : `${rangeFmt.format(days[0])} – ${rangeFmt.format(days[6])}`;

  const gridCols = `${GUTTER_W}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Toolbar — Group pill · week range (Outfit) · nav chips · Week/Day. */}
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-paper px-5 py-3">
        {groupFilter && (
          <Select
            aria-label={groupFilter.ariaLabel}
            size="sm"
            fullWidth={false}
            className="w-36 truncate"
            value={groupFilter.value}
            onChange={(e) => groupFilter.onChange(e.target.value)}
            options={groupFilter.options}
          />
        )}
        <span
          className="text-ink"
          style={{ fontFamily: OUTFIT, fontSize: 17, fontWeight: 800 }}
        >
          {rangeLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <NavChip aria-label={t('calPrev')} onClick={() => shift(-1)}>
            ‹
          </NavChip>
          <NavChip
            aria-label={t('calToday')}
            wide
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            {t('calToday')}
          </NavChip>
          <NavChip aria-label={t('calNext')} onClick={() => shift(1)}>
            ›
          </NavChip>
        </div>
        <div className="ml-auto">
          <Segmented
            ariaLabel={t('calViewLabel')}
            value={view}
            onChange={(v) => onViewChange(v as CalendarView)}
            options={[
              { value: 'week', label: t('calWeek') },
              { value: 'day', label: t('calDay') },
            ]}
          />
        </div>
      </div>

      {/* Weekday header — bg paper-soft, today date in amore. */}
      <div
        className="grid border-b-2 border-ink bg-paper-soft"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div />
        {days.map((day) => {
          const isToday = sameLocalDay(day, new Date());
          return (
            <div
              key={day.toISOString()}
              className="border-l border-line-soft px-1 py-1.5 text-center first:border-l-0"
            >
              <div className="font-mono text-xs font-bold uppercase text-mute-soft">
                {dowFmt.format(day)}
              </div>
              <div
                className={isToday ? 'text-amore' : 'text-ink'}
                style={{ fontFamily: OUTFIT, fontSize: 15, fontWeight: 800 }}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid — 80px/hour, colored time-blocks over a clickable half-hour grid. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Hour gutter */}
          <div>
            {hourLabels.map((h) => (
              <div
                key={h}
                className="border-b border-line-soft px-1.5 pt-0.5 text-right font-mono text-xs text-mute-soft"
                style={{ height: PX_PER_HOUR }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const daySlots = slotsByDay.get(day.toDateString()) ?? [];
            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-line-soft first:border-l-0"
                style={{ height: DAY_HEIGHT }}
              >
                {/* Clickable half-hour grid rows */}
                {Array.from({ length: SPAN_MIN / SNAP_MIN }, (_, r) => (
                  <div
                    key={r}
                    role="button"
                    tabIndex={-1}
                    onClick={() => handleCellClick(day, r * SNAP_MIN)}
                    className="absolute inset-x-0 cursor-pointer border-b border-line-soft transition-colors hover:bg-paper-soft"
                    style={{
                      top: r * SNAP_MIN * PX_PER_MIN,
                      height: SNAP_MIN * PX_PER_MIN,
                    }}
                  />
                ))}

                {/* Colored time-blocks */}
                {daySlots.map((s) => {
                  const start = new Date(s.start_at);
                  const end = new Date(s.end_at);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const endMin = end.getHours() * 60 + end.getMinutes();
                  const top = Math.max(startMin - DAY_START_MIN, 0) * PX_PER_MIN;
                  const rawBottom =
                    Math.min(endMin - DAY_START_MIN, SPAN_MIN) * PX_PER_MIN;
                  const height = Math.max(rawBottom - top, 30);
                  const skin = BLOCK[s.status];
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
                      className={[
                        'absolute inset-x-1 z-fab cursor-pointer overflow-hidden border-2 px-1.5 py-1 text-left',
                        // design-allow-hardcoded -- CD frame 02 time-block radius 9px (documented outlier band, PROJECT.md §9); no exact DS radius token between rounded-xs(4) and rounded-sm(14)
                        'rounded-[9px]',
                        skin.block,
                      ].join(' ')}
                      style={{
                        top,
                        height,
                        boxShadow: skin.shadowVar,
                      }}
                      title={`${slotLabel(s)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`}
                    >
                      <div className="mb-0.5 flex items-center gap-1">
                        <span
                          className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${skin.dot}`}
                        />
                        <span
                          className={`truncate ${skin.label}`}
                          style={{ fontFamily: OUTFIT, fontSize: 11, fontWeight: 800 }}
                        >
                          {slotLabel(s)}
                        </span>
                      </div>
                      <div className="truncate font-mono text-xs text-mute">
                        {timeFmt.format(start)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend — colored swatches + click hint. */}
      <div className="flex flex-wrap items-center gap-4 border-t-2 border-ink bg-paper-soft px-5 py-2.5">
        <LegendChip
          className="border-slot-proposed-border bg-slot-proposed-bg"
          label={t('statusProposed')}
        />
        <LegendChip
          className="border-slot-confirmed-border bg-slot-confirmed-bg"
          label={t('statusConfirmed')}
        />
        <LegendChip
          className="border-slot-cancelled-border bg-slot-cancelled-bg"
          label={t('statusCancelled')}
        />
        <span className="ml-auto text-xs text-mute-soft">{t('calClickHint')}</span>
      </div>
    </div>
  );
}

function LegendChip({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-3.5 w-3.5 rounded-xs border-[1.5px] ${className}`}
      />
      <span className="text-xs font-semibold text-mute">{label}</span>
    </span>
  );
}

// Memphis nav chip (CD frame 02 toolbar) — 1.5px ink border, radius 8, 2px hard
// shadow. Native <button> because the ChromeButton primitive is 4px-radius and
// can't take this square/pill Memphis chrome; per-line disable per the codebase
// convention for CD-authored controls.
function NavChip({
  children,
  onClick,
  wide,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  wide?: boolean;
  'aria-label': string;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD Memphis nav chip (1.5px ink · radius8 · 2px hard shadow); Button/ChromeButton chrome (radius 4/14) can't reproduce this
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        'inline-flex h-[30px] items-center justify-center border-[1.5px] border-ink bg-paper text-md font-bold text-ink shadow-memphis-sm transition-colors hover:bg-paper-soft',
        // design-allow-hardcoded -- CD frame 02 nav-chip radius 8px (documented outlier band, PROJECT.md §9); no exact DS radius token between rounded-xs(4) and rounded-sm(14)
        'rounded-[8px]',
        wide ? 'px-3' : 'w-[30px]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// Memphis segmented control (ink-fill active segment). Shared shape across the
// recsched screens; a fresh build per CD (the flat <Tabs> primitive would
// downgrade the treatment). role=tablist keeps it AT-legible.
function Segmented<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode }[];
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 overflow-hidden rounded-pill border-2 border-ink shadow-memphis-sm"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          // eslint-disable-next-line react/forbid-elements -- CD Memphis segmented pill (ink-fill active seg); a per-Button border/shadow/radius can't compose into one unified control
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={[
              'px-3.5 py-1 text-sm font-bold transition-colors',
              active ? 'bg-ink text-paper' : 'bg-paper text-mute hover:text-ink',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
