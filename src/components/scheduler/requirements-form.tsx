'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DayOfWeek, ExplicitSlot, Requirement } from '@/lib/scheduler/types';
import { requirementTz } from '@/lib/scheduler/types';
import { TIMEZONES, tzShortOffset } from '@/lib/scheduler/timezone';
import { DateRangeCalendar } from './date-range-calendar';

type Props = {
  value: Requirement;
  onChange: (next: Requirement) => void;
};

const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

export function RequirementsForm({ value, onChange }: Props) {
  const t = useTranslations('Scheduler.requirements');
  const weekdayShort = t.raw('weekdayShort') as string[];
  const [open, setOpen] = useState(true);

  function set<K extends keyof Requirement>(key: K, v: Requirement[K]) {
    onChange({ ...value, [key]: v });
  }

  function setRange(next: { start: string; end: string }) {
    onChange({ ...value, startDate: next.start, endDate: next.end });
  }

  function toggleDay(d: DayOfWeek) {
    const has = value.daysOfWeek.includes(d);
    set('daysOfWeek', has ? value.daysOfWeek.filter((x) => x !== d) : [...value.daysOfWeek, d].sort());
  }

  function addSlot() {
    const next: ExplicitSlot = {
      id: crypto.randomUUID(),
      date: value.startDate || '',
      start: value.startTime,
      end: value.endTime,
    };
    set('explicitSlots', [...value.explicitSlots, next]);
  }

  function updateSlot(id: string, patch: Partial<ExplicitSlot>) {
    set(
      'explicitSlots',
      value.explicitSlots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  }

  function removeSlot(id: string) {
    set('explicitSlots', value.explicitSlots.filter((s) => s.id !== id));
  }

  const summary = buildSummary(value, weekdayShort, t('summaryEmpty'));

  return (
    <section data-coach="scheduler:requirements" className="border border-line bg-paper [border-radius:14px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left"
      >
        <span
          className={
            'inline-block text-mute transition-transform duration-150 ' + (open ? 'rotate-90' : '')
          }
        >
          ›
        </span>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">{t('title')}</h2>
        <span className="ml-auto truncate text-[11.5px] text-mute-soft">{summary}</span>
      </button>

      {open && (
        <div className="border-t border-line-soft px-5 pb-5 pt-4">
          <p className="mb-4 text-[12px] leading-[1.7] text-mute">{t('description')}</p>

          <div className="grid gap-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
            {/* Left: range calendar + time row */}
            <div className="space-y-3">
              <DateRangeCalendar
                start={value.startDate}
                end={value.endDate}
                weekdayShort={weekdayShort}
                onChange={setRange}
              />
              <div className="text-[11px] text-mute-soft">{t('rangeHint')}</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('startTime')}>
                  <input
                    type="time"
                    value={value.startTime}
                    onChange={(e) => set('startTime', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label={t('endTime')}>
                  <input
                    type="time"
                    value={value.endTime}
                    onChange={(e) => set('endTime', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label={t('timezoneLabel')}>
                <select
                  value={requirementTz(value)}
                  onChange={(e) => set('timezone', e.target.value)}
                  className={inputCls}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.id} value={tz.id}>
                      {t(`tz.${tz.key}`)} ({tzShortOffset(tz.id)})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Right: duration + weekdays + explicit slots */}
            <div className="space-y-4">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <Field label={t('duration')}>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={value.durationMin}
                    onChange={(e) => set('durationMin', Math.max(15, Number(e.target.value) || 0))}
                    className={inputCls}
                  />
                </Field>
                <Field label={t('daysOfWeek')}>
                  <div className="flex flex-wrap gap-1">
                    {ALL_DAYS.map((d) => {
                      const active = value.daysOfWeek.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDay(d)}
                          className={
                            'h-7 w-7 border text-[11px] [border-radius:14px] transition-colors duration-[120ms] ' +
                            (active
                              ? 'border-ink bg-ink text-paper'
                              : 'border-line bg-paper text-mute hover:border-line-soft hover:text-ink-2')
                          }
                        >
                          {weekdayShort[d]}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>

              <div className="border-t border-line-soft pt-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <h3 className="text-[12.5px] font-semibold text-ink-2">{t('explicitSlots')}</h3>
                    <p className="mt-0.5 text-[11px] text-mute-soft">{t('explicitSlotsHint')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={addSlot}
                    className="border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-ink [border-radius:14px]"
                  >
                    + {t('addSlot')}
                  </button>
                </div>

                {value.explicitSlots.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {value.explicitSlots.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="date"
                          value={s.date}
                          onChange={(e) => updateSlot(s.id, { date: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          type="time"
                          value={s.start}
                          onChange={(e) => updateSlot(s.id, { start: e.target.value })}
                          className={inputCls}
                        />
                        <span className="text-mute-soft">–</span>
                        <input
                          type="time"
                          value={s.end}
                          onChange={(e) => updateSlot(s.id, { end: e.target.value })}
                          className={inputCls}
                        />
                        <button
                          type="button"
                          onClick={() => removeSlot(s.id)}
                          className="ml-auto text-[11px] text-mute hover:text-amore"
                        >
                          {t('remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function buildSummary(req: Requirement, weekdayShort: string[], emptyText: string): string {
  if (!req.startDate || !req.endDate) return emptyText;
  const days = req.daysOfWeek
    .slice()
    .sort()
    .map((d) => weekdayShort[d])
    .join('·');
  return `${req.startDate} ~ ${req.endDate} · ${req.startTime}–${req.endTime} · ${req.durationMin}m · ${days}`;
}

const inputCls =
  'border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-2 focus:border-amore focus:outline-none [border-radius:14px]';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={'flex flex-col gap-1 ' + className}>
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-mute-soft">{label}</span>
      {children}
    </label>
  );
}
