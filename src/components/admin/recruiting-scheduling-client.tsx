'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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
import { BROADCAST_THREAD_ID } from '@/lib/scheduling/messages';
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

// participant_token drives the public share link (PR4). It is rendered only as
// a copyable `/schedule/<token>` URL — never shown raw in a data cell.
export type SchedCandidate = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
  participant_token: string;
  // Coarse per-candidate flag set by the "개인 확정" bulk action (PR-A).
  status: string;
};

type Props = {
  batches: SchedBatch[];
  selectedBatchId: string | null;
  candidates: SchedCandidate[];
  slots: SchedSlot[];
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Chat lives in a right-rail sidebar of the calendar view now (PR-B); the
// standalone 'chat' tab is gone.
type ViewTab = 'list' | 'calendar';

// Fixed pixel widths for the three sticky-left columns so their `left` offsets
// are deterministic (checkbox → name → contact). The rest of the table scrolls
// horizontally underneath them.
const STICKY_W = { check: 44, name: 168, contact: 184 };
const STICKY_LEFT = {
  check: 0,
  name: STICKY_W.check,
  contact: STICKY_W.check + STICKY_W.name,
};
// Max width for scrollable data cells — nowrap + ellipsis past this.
const DATA_CELL_MAX = 240;

// Sticky column cells must be pinned to an EXACT width (min = max = width) so
// the next sticky column's `left` offset lines up perfectly — otherwise an
// auto-sized column grows past its width hint and the following frozen column
// overlaps it, leaving a gap where scrolling content bleeds through.
function stickyStyle(left: number, w: number): CSSProperties {
  return { left, width: w, minWidth: w, maxWidth: w };
}

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
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Bulk selection + actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignBatchId, setAssignBatchId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Captured once at mount — the "upcoming vs past" boundary for the list's
  // 다음 슬롯 column. Reading Date.now() directly in render trips
  // react-hooks/purity; a lazy initializer is the codebase's convention.
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<ViewTab>('list');
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);

  // Chat sidebar (unified calendar view). `chatThread` is a candidate id or the
  // broadcast sentinel; `chatOpen` toggles the right rail. Clicking a confirmed
  // attendee opens their private thread; the broadcast button opens the shared
  // announcement thread.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatThread, setChatThread] = useState<string>(BROADCAST_THREAD_ID);

  function openChat(threadId: string) {
    setChatThread(threadId);
    setChatOpen(true);
  }

  // Extra (non email/name/phone) columns present across the batch, preserved in
  // `fields`. Union so a candidate missing a key still renders an empty cell.
  const fieldColumns = Array.from(
    new Set(candidates.flatMap((c) => Object.keys(c.fields))),
  ).sort();

  function candidateLabel(c: SchedCandidate): string {
    return c.name || c.email || c.phone || t('unnamedCandidate');
  }

  // Contact column: phone first, email fallback (spec §2 — 연락처=phone; 없으면 email).
  function contactValue(c: SchedCandidate): string | null {
    return c.phone || c.email || null;
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

  // --- Selection ---

  const allSelected =
    candidates.length > 0 && candidates.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setShowAssign(false);
    setAssignTitle('');
    setAssignBatchId('');
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

  async function importSheet() {
    const url = sheetUrl.trim();
    if (!url || !selectedBatchId || importing) return;
    setImporting(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/scheduling/batches/${selectedBatchId}/import-sheet`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetUrl: url }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
      };
      // Not connected / missing Sheets scope → bounce into the existing
      // recruiting Google OAuth with the Sheets superset (share=1). No new
      // auth flow — same connection the forms feature uses.
      if (
        res.status === 412 ||
        json.error === 'google_not_connected' ||
        json.error === 'reconsent_required'
      ) {
        setMessage(t('sheetsConnectPrompt'));
        window.location.href = '/api/recruiting/google/start?share=1';
        return;
      }
      if (!res.ok) {
        setMessage(sheetErrorMessage(json.error));
        return;
      }
      setMessage(t('uploaded', { count: json.upserted ?? 0 }));
      setSheetUrl('');
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  function sheetErrorMessage(code: string | undefined): string {
    switch (code) {
      case 'invalid_sheet_url':
        return t('sheetsInvalidUrl');
      case 'no_candidates':
        return t('noCandidates');
      case 'sheet_read_failed':
        return t('sheetsReadFailed');
      default:
        return t('sheetsImportFailed');
    }
  }

  // --- Bulk actions ---

  async function confirmSelected() {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/scheduling/candidates/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setMessage(t('bulkConfirmFailed'));
        return;
      }
      setMessage(t('bulkConfirmed', { count: json.updated ?? 0 }));
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function assignSelected() {
    if (selected.size === 0 || bulkBusy) return;
    const title = assignTitle.trim();
    if (!title && !assignBatchId) return;
    setBulkBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/scheduling/candidates/assign-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateIds: [...selected],
          ...(title ? { newBatchTitle: title } : { batchId: assignBatchId }),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        moved?: number;
        batchId?: string;
        error?: string;
      };
      if (!res.ok) {
        setMessage(
          json.error === 'duplicate_in_target'
            ? t('bulkDuplicateInTarget')
            : t('bulkAssignFailed'),
        );
        return;
      }
      clearSelection();
      // Moved candidates leave the current batch — follow them to the target so
      // the result is visible instead of an empty-looking current list.
      if (json.batchId) {
        router.push(`/admin/recruiting-scheduling?batch=${json.batchId}`);
      }
      router.refresh();
    } finally {
      setBulkBusy(false);
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

  // Confirmed attendees only (spec §2) — the calendar view's inline roster.
  const confirmedCandidates = candidates.filter(
    (c) => c.status === 'confirmed',
  );

  const currentBatch = batches.find((b) => b.id === selectedBatchId) ?? null;

  // Existing batches other than the current one, as move targets.
  const assignBatchOptions = [
    { value: '', label: t('bulkChooseBatch') },
    ...batches
      .filter((b) => b.id !== selectedBatchId)
      .map((b) => ({ value: b.id, label: b.title })),
  ];

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
          {/* Source entry — file upload OR Google Sheets import (spec §1). */}
          <div className="flex flex-col gap-4 md:flex-row">
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
              className="flex-1 px-6 py-12"
            />
            <div className="flex flex-1 flex-col gap-2 rounded-sm border border-line px-6 py-6">
              <p className="text-sm font-medium text-ink">{t('sheetsTitle')}</p>
              <p className="text-sm text-mute">{t('sheetsHelper')}</p>
              <Input
                aria-label={t('sheetsUrlLabel')}
                placeholder={t('sheetsUrlPlaceholder')}
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') importSheet();
                }}
              />
              <Button
                variant="secondary"
                onClick={importSheet}
                disabled={importing || !sheetUrl.trim()}
              >
                {importing ? t('sheetsImporting') : t('sheetsImport')}
              </Button>
            </div>
          </div>

          {message && <p className="text-sm text-ink">{message}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              aria-label={t('viewTabsLabel')}
              value={tab}
              onValueChange={(v) => setTab(v as ViewTab)}
              items={[
                { value: 'list', label: t('tabList') },
                { value: 'calendar', label: t('tabCalendar') },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => openCreate()}
              disabled={candidates.length === 0}
            >
              {t('slotAdd')}
            </Button>
          </div>

          {tab === 'list' ? (
            <>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-paper-soft px-3 py-2">
                  <span className="text-sm text-ink">
                    {t('bulkSelected', { count: selected.size })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={confirmSelected}
                    disabled={bulkBusy}
                  >
                    {t('bulkConfirm')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowAssign((v) => !v)}
                    disabled={bulkBusy}
                  >
                    {t('bulkAssign')}
                  </Button>
                  <Button size="sm" variant="link" onClick={clearSelection}>
                    {t('bulkClear')}
                  </Button>
                  {showAssign && (
                    <div className="flex w-full flex-wrap items-end gap-2 pt-2">
                      <Input
                        label={t('bulkNewBatch')}
                        placeholder={t('newBatchPlaceholder')}
                        value={assignTitle}
                        onChange={(e) => setAssignTitle(e.target.value)}
                      />
                      <span className="pb-2 text-sm text-mute">
                        {t('bulkOr')}
                      </span>
                      <div className="min-w-[200px]">
                        <Select
                          label={t('bulkExistingBatch')}
                          value={assignBatchId}
                          onChange={(e) => setAssignBatchId(e.target.value)}
                          options={assignBatchOptions}
                          disabled={!!assignTitle.trim()}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={assignSelected}
                        disabled={
                          bulkBusy || (!assignTitle.trim() && !assignBatchId)
                        }
                      >
                        {t('bulkAssignGo')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                {/* border-separate (not collapse): under border-collapse, z-index
                    on sticky <td> is ignored in Chrome so scrolling columns
                    bleed through the frozen ones. Row borders move onto the
                    cells via thead/tbody variants since <tr> borders don't
                    paint in separate mode. */}
                <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-sm">
                  <thead className="[&_th]:border-b [&_th]:border-line">
                    <tr className="text-left text-mute">
                      <th
                        className="sticky z-table-cell-sticky bg-paper px-3 py-2"
                        style={stickyStyle(STICKY_LEFT.check, STICKY_W.check)}
                      >
                        <Checkbox
                          aria-label={t('selectAll')}
                          checked={allSelected}
                          onChange={toggleAll}
                        />
                      </th>
                      <th
                        className="sticky z-table-cell-sticky bg-paper px-3 py-2 font-medium"
                        style={stickyStyle(STICKY_LEFT.name, STICKY_W.name)}
                      >
                        {t('colName')}
                      </th>
                      <th
                        className="sticky z-table-cell-sticky border-r border-line bg-paper px-3 py-2 font-medium"
                        style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                      >
                        {t('colContact')}
                      </th>
                      <th className="px-3 py-2 font-medium">{t('colEmail')}</th>
                      {fieldColumns.map((col) => (
                        <th key={col} className="px-3 py-2 font-medium">
                          {col}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium">{t('colSlot')}</th>
                      <th className="px-3 py-2 font-medium">
                        {t('colShareLink')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-b [&_td]:border-line-soft">
                    {candidates.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-6 text-center text-mute"
                          colSpan={6 + fieldColumns.length}
                        >
                          {t('emptyCandidates')}
                        </td>
                      </tr>
                    ) : (
                      candidates.map((c) => {
                        const next = nextSlotForCandidate(c.id, slots, now);
                        const checked = selected.has(c.id);
                        const contact = contactValue(c);
                        return (
                          <tr key={c.id}>
                            <td
                              className="sticky z-table-cell-sticky bg-paper px-3 py-2"
                              style={stickyStyle(STICKY_LEFT.check, STICKY_W.check)}
                            >
                              <Checkbox
                                aria-label={t('selectRow')}
                                checked={checked}
                                onChange={() => toggleOne(c.id)}
                              />
                            </td>
                            <td
                              className="sticky z-table-cell-sticky bg-paper px-3 py-2 text-ink"
                              style={stickyStyle(STICKY_LEFT.name, STICKY_W.name)}
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="truncate"
                                  title={c.name ?? undefined}
                                >
                                  {c.name ?? '—'}
                                </span>
                                {c.status === 'confirmed' && (
                                  <span className="shrink-0 rounded-xs bg-success px-1 py-0.5 text-xs text-paper">
                                    {t('confirmedChip')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className="sticky z-table-cell-sticky border-r border-line bg-paper px-3 py-2 text-ink"
                              style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                            >
                              <div
                                className="truncate"
                                title={contact ?? undefined}
                              >
                                {contact ?? '—'}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-ink">
                              <div
                                className="truncate"
                                style={{ maxWidth: DATA_CELL_MAX }}
                                title={c.email ?? undefined}
                              >
                                {c.email ?? '—'}
                              </div>
                            </td>
                            {fieldColumns.map((col) => (
                              <td key={col} className="px-3 py-2 text-mute">
                                <div
                                  className="truncate"
                                  style={{ maxWidth: DATA_CELL_MAX }}
                                  title={c.fields[col] || undefined}
                                >
                                  {c.fields[col] || ''}
                                </div>
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
                                      {slotTimeFmt.format(
                                        new Date(next.start_at),
                                      )}
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
                            <td className="px-3 py-2">
                              <ShareLinkCell
                                candidateId={c.id}
                                token={c.participant_token}
                                onReissued={() => router.refresh()}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            // Unified calendar view (PR-B): free-text title + calendar +
            // confirmed-attendee roster on the left; chat opens in the right
            // rail (inline sidebar on wide screens, overlay drawer on narrow).
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <BatchTitleField
                  key={selectedBatchId}
                  batchId={selectedBatchId}
                  title={currentBatch?.title ?? ''}
                  onSaved={() => router.refresh()}
                />

                <SchedulingCalendar
                  slots={slots}
                  candidateName={(id) =>
                    candidateNameById.get(id) ?? t('unnamedCandidate')
                  }
                  view={calendarView}
                  onViewChange={setCalendarView}
                  onCreateAt={(start) => openCreate(start)}
                  onEditSlot={openEdit}
                />

                {/* Confirmed attendees, inline in the same view (spec §2). */}
                <div className="flex flex-col gap-2 rounded-sm border border-line p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {t('confirmedHeading', {
                        count: confirmedCandidates.length,
                      })}
                    </p>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => openChat(BROADCAST_THREAD_ID)}
                    >
                      {t('confirmedBroadcastCta')}
                    </Button>
                  </div>
                  {confirmedCandidates.length === 0 ? (
                    <p className="text-sm text-mute-soft">
                      {t('confirmedEmpty')}
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-line-soft">
                      {confirmedCandidates.map((c) => {
                        const next = nextSlotForCandidate(c.id, slots, now);
                        const contact = contactValue(c);
                        const active = chatOpen && chatThread === c.id;
                        return (
                          <li key={c.id}>
                            {/* eslint-disable-next-line react/forbid-elements -- full-width multiline attendee-row selector opening the chat rail; Button primitive chrome unsuitable */}
                            <button
                              type="button"
                              onClick={() => openChat(c.id)}
                              className={[
                                'flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors',
                                active
                                  ? 'bg-paper-soft'
                                  : 'hover:bg-paper-soft',
                              ].join(' ')}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-ink">
                                  {candidateLabel(c)}
                                </span>
                                {contact && (
                                  <span className="block truncate text-xs text-mute-soft">
                                    {contact}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-xs text-mute">
                                {next ? (
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
                                    {slotTimeFmt.format(
                                      new Date(next.start_at),
                                    )}
                                  </span>
                                ) : (
                                  t('confirmedNoSlot')
                                )}
                              </span>
                              <span className="shrink-0 text-xs text-amore">
                                {t('confirmedChatCta')}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Chat rail — inline sidebar (lg+) / overlay drawer (mobile). */}
              {chatOpen && (
                <>
                  <div
                    className="fixed inset-0 z-modal bg-ink/20 lg:hidden"
                    onClick={() => setChatOpen(false)}
                    aria-hidden
                  />
                  <aside className="fixed inset-y-0 right-0 z-modal flex w-full max-w-md flex-col border-l border-line bg-paper lg:static lg:z-auto lg:h-[36rem] lg:w-96 lg:max-w-none lg:shrink-0 lg:rounded-sm lg:border">
                    <SchedulingChatPanel
                      batchId={selectedBatchId}
                      candidates={candidateOptions}
                      layout="sidebar"
                      selectedThread={chatThread}
                      onSelectThread={setChatThread}
                      onClose={() => setChatOpen(false)}
                    />
                  </aside>
                </>
              )}
            </div>
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

// Inline free-text calendar title (spec §1). The batch title doubles as the
// calendar heading; edits save immediately on blur or Enter via PATCH. Keyed on
// batchId in the parent so a batch switch reseeds the field.
function BatchTitleField({
  batchId,
  title,
  onSaved,
}: {
  batchId: string;
  title: string;
  onSaved: () => void;
}) {
  const t = useTranslations('RecruitingScheduling');
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = value.trim();
    // No-op on empty or unchanged — keeps the batch from being blanked out and
    // avoids a redundant refresh on every blur.
    if (saving || !next || next === title) {
      if (!next) setValue(title);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/scheduling/batches/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (res.ok) onSaved();
      else setValue(title);
    } catch {
      setValue(title);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Input
      aria-label={t('calendarTitleLabel')}
      placeholder={t('calendarTitlePlaceholder')}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="font-semibold"
    />
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

// Copy the candidate's public `/schedule/<token>` link, plus a reissue action
// that rotates the token (invalidating any previously shared link). The URL is
// built from window.location.origin at click time so it always matches the
// deployment the admin is on.
function ShareLinkCell({
  candidateId,
  token,
  onReissued,
}: {
  candidateId: string;
  token: string;
  onReissued: () => void;
}) {
  const t = useTranslations('RecruitingScheduling');
  const [copied, setCopied] = useState(false);
  const [reissuing, setReissuing] = useState(false);

  async function copyLink() {
    const url = `${window.location.origin}/schedule/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permission) — no-op; the admin
      // can still open the page manually.
    }
  }

  async function reissue() {
    if (reissuing) return;
    if (!window.confirm(t('shareReissueConfirm'))) return;
    setReissuing(true);
    try {
      const res = await fetch(
        `/api/scheduling/candidates/${candidateId}/reissue-token`,
        { method: 'POST' },
      );
      if (res.ok) onReissued();
    } finally {
      setReissuing(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="link" size="xs" onClick={copyLink}>
        {copied ? t('shareCopied') : t('shareCopy')}
      </Button>
      <span className="text-mute-soft">·</span>
      <Button
        variant="link"
        size="xs"
        onClick={reissue}
        disabled={reissuing}
      >
        {reissuing ? t('shareReissuing') : t('shareReissue')}
      </Button>
    </span>
  );
}
