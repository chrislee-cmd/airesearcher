'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RequirementsForm } from './requirements-form';
import { CalendarView } from './calendar-view';
import { AttendeesPanel } from './attendees-panel';
import { DEFAULT_REQUIREMENT } from '@/lib/scheduler/types';
import type { Attendee, ConfirmedSlot, Requirement } from '@/lib/scheduler/types';

export function SchedulerPage() {
  const t = useTranslations('Features.scheduler');
  const [requirement, setRequirement] = useState<Requirement>(DEFAULT_REQUIREMENT);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSlot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);

  function addAttendee(input: Omit<Attendee, 'id'>) {
    const a: Attendee = { ...input, id: crypto.randomUUID() };
    setAttendees((prev) => [...prev, a]);
    setSelectedId(a.id);
  }

  function updateAttendee(id: string, patch: Partial<Omit<Attendee, 'id'>>) {
    setAttendees((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeAttendee(id: string) {
    setAttendees((prev) => prev.filter((a) => a.id !== id));
    setConfirmed((prev) => prev.filter((c) => c.attendeeId !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  function setSlotFor(
    attendeeId: string,
    slot: Omit<ConfirmedSlot, 'id' | 'attendeeId'> | null,
  ) {
    setConfirmed((prev) => {
      const without = prev.filter((c) => c.attendeeId !== attendeeId);
      if (!slot) return without;
      return [...without, { id: crypto.randomUUID(), attendeeId, ...slot }];
    });
  }

  function pickSlotFromCalendar(date: string, start: string, end: string) {
    if (!selectedId) return;
    setSlotFor(selectedId, { date, start, end });
  }

  function bulkImport(payload: {
    attendees: Attendee[];
    slots: { attendeeId: string; date: string; start: string; end: string }[];
    headers: string[];
  }) {
    if (payload.attendees.length === 0) return;
    setAttendees((prev) => [...prev, ...payload.attendees]);
    setConfirmed((prev) => [
      ...prev,
      ...payload.slots.map((s) => ({ id: crypto.randomUUID(), ...s })),
    ]);
    setImportHeaders((prev) => {
      const next = [...prev];
      for (const h of payload.headers) if (!next.includes(h)) next.push(h);
      return next;
    });
    const first = payload.attendees[0];
    if (first) setSelectedId(first.id);
  }

  return (
    <div className="mx-auto max-w-[1240px] px-2 pb-16 pt-8">
      <header className="border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">{t('title')}</h1>
        <p className="mt-2 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {t('description')}
        </p>
      </header>

      <div className="mt-6 space-y-5">
        <RequirementsForm value={requirement} onChange={setRequirement} />
        <CalendarView
          requirement={requirement}
          confirmed={confirmed}
          attendees={attendees}
          selectedAttendeeId={selectedId}
          onPickSlot={pickSlotFromCalendar}
        />
        <AttendeesPanel
          attendees={attendees}
          confirmed={confirmed}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={addAttendee}
          onUpdate={updateAttendee}
          onRemove={removeAttendee}
          onSetSlot={setSlotFor}
          onImport={bulkImport}
          durationMin={requirement.durationMin}
          importHeaders={importHeaders}
        />
      </div>
    </div>
  );
}
