'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  SchedulingCalendar,
  type CalendarView,
} from '@/components/admin/scheduling-calendar';
import {
  SlotEditorModal,
  type SlotDraft,
} from '@/components/admin/slot-editor-modal';
import { SchedulingChatPanel } from '@/components/admin/scheduling-chat-panel';
import {
  type SchedSlot,
  type SlotStatus,
  nextSlotForCandidate,
  toLocalInputValue,
} from '@/lib/scheduling/slots';

export type SchedBatch = {
  id: string;
  title: string;
  created_at: string;
};

// participant_token is deliberately absent — PR4 surfaces it via the public
// participant link; the PR1 list never renders it.
export type SchedCandidate = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
};

type Props = {
  batches: SchedBatch[];
  selectedBatchId: string | null;
  candidates: SchedCandidate[];
  slots: SchedSlot[];
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type ViewTab = 'list' | 'calendar' | 'chat';

export function RecruitingSchedulingClient({
  batches,
  selectedBatchId,
  candidates,
  slots,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const router = useRouter();
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Captured once at mount — the "upcoming vs past" boundary for the list's
  // 다음 슬롯 column. Reading Date.now() directly in render trips
  // react-hooks/purity; a lazy initializer is the codebase's convention.
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<ViewTab>('list');
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);

  // Extra (non email/name/phone) columns present across the batch, preserved in
  // `fields`. Union so a candidate missing a key still renders an empty cell.
  const fieldColumns = Array.from(
    new Set(candidates.flatMap((c) => Object.keys(c.fields))),
  ).sort();

  function candidateLabel(c: SchedCandidate): string {
    return c.name || c.email || c.phone || t('unnamedCandidate');
  }

  const candidateNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) map.set(c.id, candidateLabel(c));
    return map;
    // candidateLabel closes over t; candidates is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const statusLabel = useMemo(
    () =>
      ({
        proposed: t('statusProposed'),
        confirmed: t('statusConfirmed'),
        cancelled: t('statusCancelled'),
      }) as Record<SlotStatus, string>,
    [t],
  );

  const slotTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );

  function selectBatch(id: string) {
    router.push(`/admin/recruiting-scheduling?batch=${id}`);
  }

  async function createBatch() {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/scheduling/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setMessage(t('createFailed'));
        return;
      }
      const { batch } = (await res.json()) as { batch: SchedBatch };
      setNewTitle('');
      router.push(`/admin/recruiting-scheduling?batch=${batch.id}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedBatchId || uploading) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `/api/scheduling/batches/${selectedBatchId}/upload`,
        { method: 'POST', body },
      );
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage(
          json.error === 'no_candidates' ? t('noCandidates') : t('uploadFailed'),
        );
        return;
      }
      setMessage(t('uploaded', { count: json.upserted ?? 0 }));
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  // --- Slot editor wiring ---

  function openCreate(start?: Date, candidateId?: string) {
    if (candidates.length === 0) return;
    const base = start ?? roundToNextHalfHour(new Date());
    const end = new Date(base.getTime() + 30 * 60 * 1000);
    setDraft({
      candidateId: candidateId ?? candidates[0].id,
      startLocal: toLocalInputValue(base.toISOString()),
      endLocal: toLocalInputValue(end.toISOString()),
      status: 'proposed',
      location: '',
      note: '',
    });
    setEditorOpen(true);
  }

  function openEdit(slot: SchedSlot) {
    setDraft({
      id: slot.id,
      candidateId: slot.candidate_id,
      startLocal: toLocalInputValue(slot.start_at),
      endLocal: toLocalInputValue(slot.end_at),
      status: slot.status,
      location: slot.location ?? '',
      note: slot.note ?? '',
    });
    setEditorOpen(true);
  }

  function onSaved() {
    router.refresh();
  }

  const candidateOptions = candidates.map((c) => ({
    id: c.id,
    label: candidateLabel(c),
  }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{t('title')}</h1>
        <p className="text-sm text-mute">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-line pb-6">
        <div className="min-w-[220px]">
          <Select
            label={t('batchLabel')}
            value={selectedBatchId ?? ''}
            onChange={(e) => selectBatch(e.target.value)}
            options={batches.map((b) => ({ value: b.id, label: b.title }))}
            disabled={batches.length === 0}
          />
        </div>
        <div className="flex items-end gap-2">
          <Input
            label={t('newBatchLabel')}
            placeholder={t('newBatchPlaceholder')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createBatch();
            }}
          />
          <Button
            variant="secondary"
            onClick={createBatch}
            disabled={!newTitle.trim() || creating}
          >
            {creating ? t('creating') : t('create')}
          </Button>
        </div>
      </div>

      {selectedBatchId ? (
        <>
          <FileDropZone
            accept=".csv,.xlsx"
            maxSizeBytes={MAX_UPLOAD_BYTES}
            disabled={uploading}
            onFiles={(files) => {
              if (files[0]) uploadFile(files[0]);
            }}
            onError={() => setMessage(t('fileTooLarge'))}
            label={uploading ? t('uploading') : t('uploadLabel')}
            helperText={t('uploadHelper')}
            className="px-6 py-12"
          />

          {message && <p className="text-sm text-ink">{message}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              aria-label={t('viewTabsLabel')}
              value={tab}
              onValueChange={(v) => setTab(v as ViewTab)}
              items={[
                { value: 'list', label: t('tabList') },
                { value: 'calendar', label: t('tabCalendar') },
                { value: 'chat', label: t('tabChat') },
              ]}
            />
            {tab !== 'chat' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => openCreate()}
                disabled={candidates.length === 0}
              >
                {t('slotAdd')}
              </Button>
            )}
          </div>

          {tab === 'list' ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-mute">
                    <th className="px-3 py-2 font-medium">{t('colEmail')}</th>
                    <th className="px-3 py-2 font-medium">{t('colName')}</th>
                    <th className="px-3 py-2 font-medium">{t('colPhone')}</th>
                    {fieldColumns.map((col) => (
                      <th key={col} className="px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">{t('colSlot')}</th>
                    {/* 공유링크 컬럼 자리 — PR4(참여자링크)에서 채움. */}
                    <th className="px-3 py-2 font-medium text-mute-soft">
                      {t('colShareLink')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-6 text-center text-mute"
                        colSpan={5 + fieldColumns.length}
                      >
                        {t('emptyCandidates')}
                      </td>
                    </tr>
                  ) : (
                    candidates.map((c) => {
                      const next = nextSlotForCandidate(c.id, slots, now);
                      return (
                        <tr key={c.id} className="border-b border-line-soft">
                          <td className="px-3 py-2 text-ink">{c.email ?? '—'}</td>
                          <td className="px-3 py-2 text-ink">{c.name ?? '—'}</td>
                          <td className="px-3 py-2 text-ink">{c.phone ?? '—'}</td>
                          {fieldColumns.map((col) => (
                            <td key={col} className="px-3 py-2 text-mute">
                              {c.fields[col] ?? ''}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            {next ? (
                              <Button
                                variant="link"
                                size="xs"
                                onClick={() => openEdit(next)}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                      next.status === 'confirmed'
                                        ? 'bg-success'
                                        : next.status === 'cancelled'
                                          ? 'bg-mute-soft'
                                          : 'bg-amore'
                                    }`}
                                  />
                                  <span>
                                    {slotTimeFmt.format(new Date(next.start_at))}
                                  </span>
                                  <span className="text-mute-soft">
                                    · {statusLabel[next.status]}
                                  </span>
                                </span>
                              </Button>
                            ) : (
                              <Button
                                variant="link"
                                size="xs"
                                onClick={() => openCreate(undefined, c.id)}
                              >
                                {t('assignSlot')}
                              </Button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-mute-soft">—</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : tab === 'calendar' ? (
            <SchedulingCalendar
              slots={slots}
              candidateName={(id) => candidateNameById.get(id) ?? t('unnamedCandidate')}
              view={calendarView}
              onViewChange={setCalendarView}
              onCreateAt={(start) => openCreate(start)}
              onEditSlot={openEdit}
            />
          ) : (
            <SchedulingChatPanel
              batchId={selectedBatchId}
              candidates={candidateOptions}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-mute">{t('selectBatchFirst')}</p>
      )}

      <SlotEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        draft={draft}
        candidates={candidateOptions}
        allSlots={slots}
        onSaved={onSaved}
      />
    </div>
  );
}

// Next :00 or :30 from now, so the create form opens on a tidy boundary.
function roundToNextHalfHour(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(0, 0);
  const m = c.getMinutes();
  c.setMinutes(m < 30 ? 30 : 60);
  return c;
}
