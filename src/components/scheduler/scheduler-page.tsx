'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RequirementsForm } from './requirements-form';
import { CalendarView } from './calendar-view';
import { AttendeesPanel } from './attendees-panel';
import { BookingLinksPanel, type LinkBooking, type ProjectOption } from './booking-links-panel';
import { colorForProject } from '@/lib/scheduler/project-colors';
import { DEFAULT_REQUIREMENT } from '@/lib/scheduler/types';
import type { Attendee, ConfirmedSlot, Requirement } from '@/lib/scheduler/types';
import { useWorkspace } from '../workspace-provider';

function readActiveProjectId(): string | null {
  try {
    const raw = window.localStorage.getItem('active_project:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string } | null;
    return parsed?.id ?? null;
  } catch {
    return null;
  }
}

function buildSchedulerMarkdown(
  attendees: Attendee[],
  confirmed: ConfirmedSlot[],
): string {
  const byAttendee = new Map<string, ConfirmedSlot>();
  for (const c of confirmed) byAttendee.set(c.attendeeId, c);
  const lines = [`# 스케쥴러 — ${attendees.length}명`, ''];
  for (const a of attendees) {
    const slot = byAttendee.get(a.id);
    if (slot) {
      lines.push(`- ${a.name} — ${slot.date} ${slot.start}–${slot.end}`);
    } else {
      lines.push(`- ${a.name} — 미확정`);
    }
  }
  return lines.join('\n');
}

export function SchedulerPage() {
  const t = useTranslations('Features.scheduler');
  const [requirement, setRequirement] = useState<Requirement>(DEFAULT_REQUIREMENT);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedSlot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [linkBookings, setLinkBookings] = useState<LinkBooking[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string | 'none'>>(new Set());
  useEffect(() => {
    setProjectId(readActiveProjectId());
    void (async () => {
      try {
        const res = await fetch('/api/projects', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { projects: ProjectOption[] };
        setProjects(json.projects ?? []);
      } catch {
        /* network blip */
      }
    })();
  }, []);

  const colorFor = useMemo(
    () => (pid: string | null) => colorForProject(pid, projects),
    [projects],
  );

  // 'none' is a sentinel for bookings without a project.
  const visibleProjectIds = useMemo(() => {
    const set = new Set<string | 'none'>(['none', ...projects.map((p) => p.id)]);
    for (const id of hiddenProjectIds) set.delete(id);
    return set;
  }, [projects, hiddenProjectIds]);

  function toggleProjectVisibility(id: string | 'none') {
    setHiddenProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Public booking results show up in the canvas as synthetic
  // attendees + confirmed slots so the calendar can render them as
  // locked. We keep these separate from the user's manually managed
  // attendees so the AttendeesPanel stays clean.
  const visibleLinkBookings = useMemo(
    () => linkBookings.filter((b) => visibleProjectIds.has(b.projectId ?? 'none')),
    [linkBookings, visibleProjectIds],
  );
  const linkAttendees = useMemo<Attendee[]>(
    () =>
      visibleLinkBookings.map((b) => ({
        id: `linkbooking_${b.id}`,
        name: b.name,
        email: b.email,
      })),
    [visibleLinkBookings],
  );
  const linkConfirmed = useMemo<ConfirmedSlot[]>(
    () =>
      visibleLinkBookings.map((b) => ({
        id: `linkconfirmed_${b.id}`,
        attendeeId: `linkbooking_${b.id}`,
        date: b.date,
        start: b.start,
        end: b.end,
      })),
    [visibleLinkBookings],
  );
  const calendarAttendees = useMemo(
    () => [...attendees, ...linkAttendees],
    [attendees, linkAttendees],
  );
  const calendarConfirmed = useMemo(
    () => [...confirmed, ...linkConfirmed],
    [confirmed, linkConfirmed],
  );
  // Map synthetic attendee ids → hex color so CalendarView can paint the
  // confirmed cells with a project-specific border.
  const colorByAttendeeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of visibleLinkBookings) {
      m.set(`linkbooking_${b.id}`, colorFor(b.projectId).hex);
    }
    return m;
  }, [visibleLinkBookings, colorFor]);

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

  // Debounced autosave so the canvas survives refresh / device switch.
  // Skips the initial empty mount so we don't create a phantom row on
  // every page visit. After a successful save we also (re)register a
  // workspace artifact — using a stable id so repeat saves overwrite
  // the same row rather than spamming the panel.
  const workspace = useWorkspace();
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      const projectId = readActiveProjectId();
      void (async () => {
        try {
          const res = await fetch('/api/scheduler/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              attendees,
              selected_slots: confirmed,
              meta: { requirement, importHeaders },
              project_id: projectId,
            }),
          });
          if (!res.ok) return;
          // Skip workspace registration until the canvas actually has
          // something — empty session shouldn't create a workspace row.
          if (attendees.length === 0) return;
          const json = (await res.json().catch(() => ({}))) as { id?: string };
          if (!json.id) return;
          const stamp = new Date().toISOString().slice(0, 10);
          workspace.addArtifact({
            id: `scheduler_${json.id}`,
            featureKey: 'scheduler',
            title: `scheduler-${stamp}-${attendees.length}명.md`,
            content: buildSchedulerMarkdown(attendees, confirmed),
            dbFeature: 'scheduler',
            dbId: json.id,
            projectId,
          });
        } catch (err) {
          console.warn('[scheduler] autosave failed', err);
        }
      })();
    }, 1500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees, confirmed, requirement, importHeaders]);

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
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('cost')}
        </span>
      </div>

      <div className="mt-6 space-y-5">
        <RequirementsForm value={requirement} onChange={setRequirement} />
        {(projects.length > 0 || linkBookings.some((b) => !b.projectId)) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-mute">{t('projectFilter')}</span>
            {projects.map((p) => {
              const hidden = hiddenProjectIds.has(p.id);
              const c = colorFor(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProjectVisibility(p.id)}
                  className={[
                    'inline-flex items-center gap-1 rounded border px-2 py-0.5 transition',
                    hidden ? 'border-line-soft text-mute-soft' : `${c.border} text-ink`,
                  ].join(' ')}
                  title={hidden ? t('show') : t('hide')}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: hidden ? 'transparent' : c.hex, border: `1px solid ${c.hex}` }}
                  />
                  {p.name}
                </button>
              );
            })}
            {linkBookings.some((b) => !b.projectId) && (() => {
              const hidden = hiddenProjectIds.has('none');
              const c = colorFor(null);
              return (
                <button
                  type="button"
                  onClick={() => toggleProjectVisibility('none')}
                  className={[
                    'inline-flex items-center gap-1 rounded border px-2 py-0.5 transition',
                    hidden ? 'border-line-soft text-mute-soft' : `${c.border} text-ink`,
                  ].join(' ')}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: hidden ? 'transparent' : c.hex, border: `1px solid ${c.hex}` }}
                  />
                  {t('noProject')}
                </button>
              );
            })()}
          </div>
        )}
        <CalendarView
          requirement={requirement}
          confirmed={calendarConfirmed}
          attendees={calendarAttendees}
          selectedAttendeeId={selectedId}
          onPickSlot={pickSlotFromCalendar}
          colorByAttendeeId={colorByAttendeeId}
        />
        <BookingLinksPanel
          requirement={requirement}
          projectId={projectId}
          projects={projects}
          visibleProjectIds={visibleProjectIds}
          colorFor={colorFor}
          onBookingsChange={setLinkBookings}
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
