'use client';

import { useTranslations } from 'next-intl';
import type { DayOfWeek, ExplicitSlot, Requirement } from '@/lib/scheduler/types';

type Props = {
  value: Requirement;
  onChange: (next: Requirement) => void;
};

const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

export function RequirementsForm({ value, onChange }: Props) {
  const t = useTranslations('Scheduler.requirements');
  const weekdayShort = t.raw('weekdayShort') as string[];

  function set<K extends keyof Requirement>(key: K, v: Requirement[K]) {
    onChange({ ...value, [key]: v });
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

  return (
    <section className="border border-line bg-paper p-5 [border-radius:4px]">
      <header className="border-b border-line pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">{t('title')}</h2>
        <p className="mt-1.5 text-[12px] leading-[1.7] text-mute">{t('description')}</p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label={t('startDate')}>
          <input
            type="date"
            value={value.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label={t('endDate')}>
          <input
            type="date"
            value={value.endDate}
            onChange={(e) => set('endDate', e.target.value)}
            className={inputCls}
          />
        </Field>
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
        <Field label={t('daysOfWeek')} className="col-span-2 md:col-span-3">
          <div className="flex flex-wrap gap-1.5">
            {ALL_DAYS.map((d) => {
              const active = value.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={
                    'border px-2.5 py-1 text-[12px] [border-radius:4px] transition-colors duration-[120ms] ' +
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

      <div className="mt-6 border-t border-line-soft pt-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-ink-2">{t('explicitSlots')}</h3>
            <p className="mt-1 text-[11.5px] text-mute-soft">{t('explicitSlotsHint')}</p>
          </div>
          <button
            type="button"
            onClick={addSlot}
            className="border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:border-ink [border-radius:4px]"
          >
            + {t('addSlot')}
          </button>
        </div>

        {value.explicitSlots.length > 0 && (
          <ul className="mt-3 space-y-2">
            {value.explicitSlots.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
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
                  className="ml-auto text-[11.5px] text-mute hover:text-ink-2"
                >
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const inputCls =
  'border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink-2 focus:border-amore focus:outline-none [border-radius:4px]';

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
    <label className={'flex flex-col gap-1.5 ' + className}>
      <span className="text-[11px] uppercase tracking-[0.06em] text-mute-soft">{label}</span>
      {children}
    </label>
  );
}
