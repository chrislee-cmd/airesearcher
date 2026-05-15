'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  Attendee,
  CalendarMode,
  ConfirmedSlot,
  Requirement,
} from '@/lib/scheduler/types';
import { requirementTz } from '@/lib/scheduler/types';
import {
  addDays,
  expandRequirementSlots,
  fromIso,
  isRequirementDay,
  minutesFromHHmm,
  startOfMonth,
  startOfWeek,
  toIso,
} from '@/lib/scheduler/slots';
import { getViewerTimezone, tzShortOffset } from '@/lib/scheduler/timezone';

type Props = {
  requirement: Requirement;
  confirmed: ConfirmedSlot[];
  attendees: Attendee[];
  selectedAttendeeId: string | null;
  onPickSlot: (date: string, start: string, end: string) => void;
};

export function CalendarView({
  requirement,
  confirmed,
  attendees,
  selectedAttendeeId,
  onPickSlot,
}: Props) {
  const t = useTranslations('Scheduler.calendar');
  const tReq = useTranslations('Scheduler.requirements');
  const weekdayShort = tReq.raw('weekdayShort') as string[];

  const [mode, setMode] = useState<CalendarMode>('week');
  const [cursor, setCursor] = useState<Date>(() => {
    if (requirement.startDate) return fromIso(requirement.startDate);
    return new Date();
  });

  const sourceTz = requirementTz(requirement);
  const viewerTz = useMemo(() => getViewerTimezone(), []);
  const sourceOffset = useMemo(() => tzShortOffset(sourceTz), [sourceTz]);
  const viewerOffset = useMemo(() => tzShortOffset(viewerTz), [viewerTz]);
  const tzMismatch = sourceTz !== viewerTz;

  const slots = useMemo(() => expandRequirementSlots(requirement), [requirement]);
  const attendeeById = useMemo(() => {
    const m = new Map<string, Attendee>();
    for (const a of attendees) m.set(a.id, a);
    return m;
  }, [attendees]);

  const confirmedByCell = useMemo(() => {
    const m = new Map<string, ConfirmedSlot[]>();
    for (const c of confirmed) {
      const k = `${c.date}T${c.start}`;
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [confirmed]);

  const slotsByDate = useMemo(() => {
    const m = new Map<string, { start: string; end: string }[]>();
    for (const s of slots) {
      const arr = m.get(s.date) ?? [];
      arr.push({ start: s.start, end: s.end });
      m.set(s.date, arr);
    }
    for (const [, v] of m) v.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [slots]);

  function shift(dir: -1 | 1) {
    const d = new Date(cursor);
    if (mode === 'month') d.setMonth(d.getMonth() + dir);
    else if (mode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  }

  function tryPick(date: string, start: string, end: string) {
    if (!selectedAttendeeId) return;
    onPickSlot(date, start, end);
  }

  return (
    <section data-coach="scheduler:calendar" className="border border-line bg-paper p-5 [border-radius:14px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">{t('title')}</h2>
          <p className="text-[11px] text-mute-soft">
            {t('timezoneSource', { tz: sourceTz, offset: sourceOffset })}
            {tzMismatch && (
              <>
                {' · '}
                <span className="text-amore">
                  {t('timezoneViewer', { tz: viewerTz, offset: viewerOffset })}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} labels={{ month: t('month'), week: t('week'), day: t('day') }} />
          <div className="ml-2 flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className={navBtn} aria-label={t('prev')}>‹</button>
            <button type="button" onClick={() => setCursor(new Date())} className={navBtn}>
              {t('today')}
            </button>
            <button type="button" onClick={() => shift(1)} className={navBtn} aria-label={t('next')}>›</button>
          </div>
        </div>
      </header>
      {tzMismatch && (
        <p className="mt-2 text-[11px] text-mute">{t('timezoneMismatchHint')}</p>
      )}

      <div className="mt-4">
        {mode === 'month' && (
          <MonthGrid
            cursor={cursor}
            requirement={requirement}
            slotsByDate={slotsByDate}
            confirmedByCell={confirmedByCell}
            weekdayShort={weekdayShort}
            onJumpDay={(d) => {
              setCursor(d);
              setMode('day');
            }}
          />
        )}
        {mode === 'week' && (
          <WeekGrid
            cursor={cursor}
            requirement={requirement}
            slotsByDate={slotsByDate}
            confirmedByCell={confirmedByCell}
            weekdayShort={weekdayShort}
            attendeeById={attendeeById}
            canPick={!!selectedAttendeeId}
            onPick={tryPick}
          />
        )}
        {mode === 'day' && (
          <DayList
            cursor={cursor}
            requirement={requirement}
            slotsByDate={slotsByDate}
            confirmedByCell={confirmedByCell}
            attendeeById={attendeeById}
            canPick={!!selectedAttendeeId}
            onPick={tryPick}
          />
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-4 border-t border-line-soft pt-3 text-[11.5px] text-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 border border-amore bg-amore/10" /> {t('legendAvailable')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 border border-ink bg-ink" /> {t('legendConfirmed')}
        </span>
        {!requirement.startDate && <span className="ml-auto text-mute-soft">{t('noRequirement')}</span>}
        {requirement.startDate && <span className="ml-auto text-mute-soft">{t('pickHint')}</span>}
      </footer>
    </section>
  );
}

const navBtn =
  'border border-line bg-paper px-2.5 py-1 text-[12px] text-ink-2 hover:border-ink [border-radius:14px]';

function ModeToggle({
  mode,
  onChange,
  labels,
}: {
  mode: CalendarMode;
  onChange: (m: CalendarMode) => void;
  labels: Record<CalendarMode, string>;
}) {
  const opts: CalendarMode[] = ['month', 'week', 'day'];
  return (
    <div className="flex items-center border border-line [border-radius:14px]">
      {opts.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={
            'px-3 py-1 text-[12px] transition-colors ' +
            (mode === m ? 'bg-ink text-paper' : 'bg-paper text-mute hover:text-ink-2')
          }
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function MonthGrid({
  cursor,
  requirement,
  slotsByDate,
  confirmedByCell,
  weekdayShort,
  onJumpDay,
}: {
  cursor: Date;
  requirement: Requirement;
  slotsByDate: Map<string, { start: string; end: string }[]>;
  confirmedByCell: Map<string, unknown[]>;
  weekdayShort: string[];
  onJumpDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line-soft pb-1.5">
        {weekdayShort.map((w) => (
          <div key={w} className="text-center text-[11px] uppercase tracking-[0.06em] text-mute-soft">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const iso = toIso(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const inReq = isRequirementDay(d, requirement);
          const slots = slotsByDate.get(iso) ?? [];
          const confirmedCount = slots.reduce(
            (n, s) => n + (confirmedByCell.get(`${iso}T${s.start}`)?.length ?? 0),
            0,
          );
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onJumpDay(d)}
              className={
                'min-h-[72px] border-b border-r border-line-soft p-1.5 text-left transition-colors ' +
                (inReq ? 'bg-amore/[0.06] hover:bg-amore/[0.12]' : 'hover:bg-paper-soft') +
                (inMonth ? '' : ' opacity-40')
              }
            >
              <div className="flex items-center justify-between">
                <span className={'text-[11.5px] tabular-nums ' + (inReq ? 'text-ink-2' : 'text-mute')}>
                  {d.getDate()}
                </span>
                {confirmedCount > 0 && (
                  <span className="rounded-sm bg-ink px-1 text-[10px] tabular-nums text-paper">
                    {confirmedCount}
                  </span>
                )}
              </div>
              {inReq && slots.length > 0 && (
                <div className="mt-1 text-[10px] tabular-nums text-amore">
                  {slots.length} slots
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  cursor,
  requirement,
  slotsByDate,
  confirmedByCell,
  weekdayShort,
  attendeeById,
  canPick,
  onPick,
}: {
  cursor: Date;
  requirement: Requirement;
  slotsByDate: Map<string, { start: string; end: string }[]>;
  confirmedByCell: Map<string, ConfirmedSlot[]>;
  weekdayShort: string[];
  attendeeById: Map<string, Attendee>;
  canPick: boolean;
  onPick: (date: string, start: string, end: string) => void;
}) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const startMin = minutesFromHHmm(requirement.startTime || '09:00');
  const endMin = minutesFromHHmm(requirement.endTime || '19:00');
  const labels: number[] = [];
  for (let m = Math.floor(startMin / 30) * 30; m <= endMin; m += 30) labels.push(m);

  return (
    <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-t border-line-soft">
      <div />
      {days.map((d) => (
        <div
          key={toIso(d)}
          className="border-b border-l border-line-soft px-2 py-1.5 text-center text-[11px]"
        >
          <div className="uppercase tracking-[0.06em] text-mute-soft">{weekdayShort[d.getDay()]}</div>
          <div className="tabular-nums text-ink-2">{d.getMonth() + 1}/{d.getDate()}</div>
        </div>
      ))}
      {labels.map((mLabel) => (
        <RowGroup
          key={mLabel}
          mLabel={mLabel}
          days={days}
          slotsByDate={slotsByDate}
          confirmedByCell={confirmedByCell}
          attendeeById={attendeeById}
          canPick={canPick}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function RowGroup({
  mLabel,
  days,
  slotsByDate,
  confirmedByCell,
  attendeeById,
  canPick,
  onPick,
}: {
  mLabel: number;
  days: Date[];
  slotsByDate: Map<string, { start: string; end: string }[]>;
  confirmedByCell: Map<string, ConfirmedSlot[]>;
  attendeeById: Map<string, Attendee>;
  canPick: boolean;
  onPick: (date: string, start: string, end: string) => void;
}) {
  const hh = String(Math.floor(mLabel / 60)).padStart(2, '0');
  const mm = String(mLabel % 60).padStart(2, '0');
  const isHour = mLabel % 60 === 0;
  return (
    <>
      <div
        className={
          'border-b border-line-soft px-2 py-1.5 text-right text-[10.5px] tabular-nums ' +
          (isHour ? 'text-mute' : 'text-mute-soft/70')
        }
      >
        {isHour ? `${hh}:00` : `${hh}:${mm}`}
      </div>
      {days.map((d) => {
        const iso = toIso(d);
        const cellSlots = (slotsByDate.get(iso) ?? []).filter((s) => {
          const sm = minutesFromHHmm(s.start);
          return sm >= mLabel && sm < mLabel + 30;
        });
        return (
          <div
            key={iso + '-' + mLabel}
            className={
              'min-h-[28px] border-l border-line-soft p-0.5 ' +
              (isHour ? 'border-b border-line-soft' : 'border-b border-dashed border-line-soft')
            }
          >
            <div className="flex flex-col gap-0.5">
              {cellSlots.map((s) => {
                const confirmedHere = confirmedByCell.get(`${iso}T${s.start}`) ?? [];
                const isConfirmed = confirmedHere.length > 0;
                const label = isConfirmed
                  ? confirmedHere
                      .map((c) => attendeeById.get(c.attendeeId)?.name ?? '—')
                      .join(', ')
                  : `${s.start}`;
                return (
                  <button
                    key={s.start}
                    type="button"
                    disabled={!canPick && !isConfirmed}
                    onClick={() => onPick(iso, s.start, s.end)}
                    className={
                      'w-full truncate px-1.5 py-1 text-left text-[11px] tabular-nums [border-radius:14px] ' +
                      (isConfirmed
                        ? 'border border-ink bg-ink text-paper'
                        : 'border border-amore/40 bg-amore/10 text-ink-2 hover:border-amore hover:bg-amore/20 disabled:cursor-not-allowed disabled:opacity-50')
                    }
                    title={isConfirmed ? label : `${s.start}–${s.end}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function DayList({
  cursor,
  requirement,
  slotsByDate,
  confirmedByCell,
  attendeeById,
  canPick,
  onPick,
}: {
  cursor: Date;
  requirement: Requirement;
  slotsByDate: Map<string, { start: string; end: string }[]>;
  confirmedByCell: Map<string, ConfirmedSlot[]>;
  attendeeById: Map<string, Attendee>;
  canPick: boolean;
  onPick: (date: string, start: string, end: string) => void;
}) {
  const iso = toIso(cursor);
  const slots = slotsByDate.get(iso) ?? [];
  const inReq = isRequirementDay(cursor, requirement);

  return (
    <div>
      <div className="mb-2 text-[12.5px] text-ink-2">
        {cursor.getFullYear()}.{String(cursor.getMonth() + 1).padStart(2, '0')}.
        {String(cursor.getDate()).padStart(2, '0')}
      </div>
      {slots.length === 0 ? (
        <div className="border border-dashed border-line-soft p-6 text-center text-[12px] text-mute-soft [border-radius:14px]">
          —
        </div>
      ) : (
        <ul className={'space-y-1 ' + (inReq ? '' : 'opacity-70')}>
          {slots.map((s) => {
            const confirmedHere = confirmedByCell.get(`${iso}T${s.start}`) ?? [];
            const isConfirmed = confirmedHere.length > 0;
            return (
              <li key={s.start}>
                <button
                  type="button"
                  disabled={!canPick && !isConfirmed}
                  onClick={() => onPick(iso, s.start, s.end)}
                  className={
                    'flex w-full items-center justify-between border px-3 py-2 text-[12.5px] [border-radius:14px] ' +
                    (isConfirmed
                      ? 'border-ink bg-ink text-paper'
                      : 'border-amore/40 bg-amore/10 text-ink-2 hover:border-amore hover:bg-amore/20 disabled:cursor-not-allowed disabled:opacity-50')
                  }
                >
                  <span className="tabular-nums">{s.start} – {s.end}</span>
                  {isConfirmed && (
                    <span className="text-[11.5px]">
                      {confirmedHere
                        .map((c) => attendeeById.get(c.attendeeId)?.name ?? '—')
                        .join(', ')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
