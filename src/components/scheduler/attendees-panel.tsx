'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Attendee, ConfirmedSlot } from '@/lib/scheduler/types';

type Props = {
  attendees: Attendee[];
  confirmed: ConfirmedSlot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (a: Omit<Attendee, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<Omit<Attendee, 'id'>>) => void;
  onRemove: (id: string) => void;
  onSetSlot: (attendeeId: string, slot: Omit<ConfirmedSlot, 'id' | 'attendeeId'> | null) => void;
};

export function AttendeesPanel({
  attendees,
  confirmed,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onSetSlot,
}: Props) {
  const t = useTranslations('Scheduler.attendees');
  const selected = attendees.find((a) => a.id === selectedId) ?? null;
  const selectedSlot = selected ? confirmed.find((c) => c.attendeeId === selected.id) ?? null : null;

  return (
    <section className="border border-line bg-paper p-5 [border-radius:4px]">
      <header className="border-b border-line pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">{t('title')}</h2>
        <p className="mt-1.5 text-[12px] leading-[1.7] text-mute">{t('description')}</p>
      </header>

      <div className="mt-4 grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <AttendeeList
          attendees={attendees}
          confirmed={confirmed}
          selectedId={selectedId}
          onSelect={onSelect}
          onAdd={onAdd}
        />
        <AttendeeDetail
          attendee={selected}
          slot={selectedSlot}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onSetSlot={onSetSlot}
        />
      </div>
    </section>
  );
}

function AttendeeList({
  attendees,
  confirmed,
  selectedId,
  onSelect,
  onAdd,
}: {
  attendees: Attendee[];
  confirmed: ConfirmedSlot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (a: Omit<Attendee, 'id'>) => void;
}) {
  const t = useTranslations('Scheduler.attendees');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed, phone: phone.trim() || undefined });
    setName('');
    setPhone('');
    setAdding(false);
  }

  const slotByAttendee = new Map(confirmed.map((c) => [c.attendeeId, c]));

  return (
    <div className="border border-line-soft [border-radius:4px]">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-mute-soft">
          {attendees.length}
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[12px] text-ink-2 hover:text-amore"
        >
          + {t('addAttendee')}
        </button>
      </div>
      {adding && (
        <div className="space-y-2 border-b border-line-soft p-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('name')}
            className={inputCls + ' w-full'}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('phone')}
            className={inputCls + ' w-full'}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setName('');
                setPhone('');
              }}
              className="px-2 py-1 text-[11.5px] text-mute hover:text-ink-2"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim()}
              className="border border-ink bg-ink px-3 py-1 text-[11.5px] text-paper disabled:opacity-40 [border-radius:4px]"
            >
              {t('save')}
            </button>
          </div>
        </div>
      )}
      {attendees.length === 0 && !adding ? (
        <div className="px-3 py-6 text-center text-[12px] text-mute-soft">{t('empty')}</div>
      ) : (
        <ul>
          {attendees.map((a) => {
            const slot = slotByAttendee.get(a.id);
            const active = a.id === selectedId;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className={
                    'flex w-full items-center justify-between gap-2 border-b border-line-soft px-3 py-2 text-left transition-colors ' +
                    (active ? 'bg-amore/[0.08]' : 'hover:bg-paper-soft')
                  }
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] text-ink-2">{a.name}</div>
                    {a.phone && (
                      <div className="truncate text-[11px] tabular-nums text-mute-soft">{a.phone}</div>
                    )}
                    {a.note && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5] text-mute">
                        {a.note}
                      </div>
                    )}
                  </div>
                  {slot ? (
                    <span className="shrink-0 border border-ink bg-ink px-1.5 py-0.5 text-[10px] tabular-nums text-paper [border-radius:4px]">
                      {slot.date.slice(5)} {slot.start}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-mute-soft">—</span>
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

function AttendeeDetail({
  attendee,
  slot,
  onUpdate,
  onRemove,
  onSetSlot,
}: {
  attendee: Attendee | null;
  slot: ConfirmedSlot | null;
  onUpdate: (id: string, patch: Partial<Omit<Attendee, 'id'>>) => void;
  onRemove: (id: string) => void;
  onSetSlot: (id: string, slot: Omit<ConfirmedSlot, 'id' | 'attendeeId'> | null) => void;
}) {
  const t = useTranslations('Scheduler.attendees');

  if (!attendee) {
    return (
      <div className="flex items-center justify-center border border-dashed border-line-soft p-8 text-center text-[12px] text-mute-soft [border-radius:4px]">
        {t('selectedNone')}
      </div>
    );
  }

  return (
    <div className="border border-line-soft p-4 [border-radius:4px]">
      <div className="flex items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('name')}>
            <input
              value={attendee.name}
              onChange={(e) => onUpdate(attendee.id, { name: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </Field>
          <Field label={t('email')}>
            <input
              value={attendee.email ?? ''}
              onChange={(e) => onUpdate(attendee.id, { email: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </Field>
          <Field label={t('phone')}>
            <input
              value={attendee.phone ?? ''}
              onChange={(e) => onUpdate(attendee.id, { phone: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </Field>
          <Field label={t('note')} className="md:col-span-2">
            <input
              value={attendee.note ?? ''}
              onChange={(e) => onUpdate(attendee.id, { note: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={() => onRemove(attendee.id)}
          className="shrink-0 text-[11.5px] text-mute hover:text-amore"
        >
          {t('remove')}
        </button>
      </div>

      <div className="mt-4 border-t border-line-soft pt-4">
        <h3 className="text-[13px] font-semibold text-ink-2">{t('confirmedSlot')}</h3>
        {slot ? (
          <div className="mt-2 flex items-center gap-3">
            <span className="border border-ink bg-ink px-2 py-1 text-[11.5px] tabular-nums text-paper [border-radius:4px]">
              {slot.date} · {slot.start}–{slot.end}
            </span>
            <button
              type="button"
              onClick={() => onSetSlot(attendee.id, null)}
              className="text-[11.5px] text-mute hover:text-amore"
            >
              {t('clearSlot')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-mute-soft">{t('noConfirmed')}</p>
        )}

        <ManualSlotEntry attendeeId={attendee.id} onSetSlot={onSetSlot} />
      </div>
    </div>
  );
}

function ManualSlotEntry({
  attendeeId,
  onSetSlot,
}: {
  attendeeId: string;
  onSetSlot: (id: string, slot: Omit<ConfirmedSlot, 'id' | 'attendeeId'> | null) => void;
}) {
  const t = useTranslations('Scheduler.attendees');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');

  function submit() {
    if (!date || !start || !end) return;
    onSetSlot(attendeeId, { date, start, end });
    setDate('');
  }

  return (
    <div className="mt-4 border-t border-dashed border-line-soft pt-3">
      <div className="text-[11px] uppercase tracking-[0.06em] text-mute-soft">{t('manualSlot')}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        <span className="text-mute-soft">–</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        <button
          type="button"
          onClick={submit}
          disabled={!date}
          className="ml-auto border border-ink bg-ink px-3 py-1 text-[11.5px] text-paper disabled:opacity-40 [border-radius:4px]"
        >
          {t('save')}
        </button>
      </div>
    </div>
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
