'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { useToast } from '@/components/toast-provider';
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

// Top layer above batches (PR-C). A project bundles several groups (=batches).
export type SchedProject = {
  id: string;
  title: string;
  created_at: string;
  // Project-shared master link token (BUILD-SPEC §5.1). Optional so a preview DB
  // without the additive column still types; the master-link bar hides when null.
  share_token?: string | null;
};

// A batch under a project (PR-C). `is_inbox` marks the project's upload pool
// (not a user-made group); the rest are groups formed by list assignment.
// project_id/is_inbox are optional so a preview DB without the additive columns
// still types.
export type SchedBatch = {
  id: string;
  title: string;
  created_at: string;
  project_id?: string | null;
  is_inbox?: boolean;
};

// participant_token drives the public share link (PR4). It is rendered only as
// a copyable `/schedule/<token>` URL — never shown raw in a data cell. batch_id
// tags each candidate with its group so the grouped view (PR-C) can section it.
export type SchedCandidate = {
  id: string;
  batch_id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
  participant_token: string;
  // Coarse per-candidate flag set by the "개인 확정" bulk action (PR-A).
  status: string;
};

type Props = {
  projects: SchedProject[];
  selectedProjectId: string | null;
  groups: SchedBatch[];
  candidates: SchedCandidate[];
  slots: SchedSlot[];
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Pastel tints cycled across By-group (01B) section heads (BUILD-SPEC §1 — group
// heads sky/mint/neutral). Inbox section heads neutral (paper-soft) separately.
const HEAD_TINTS = ['bg-sky', 'bg-mint', 'bg-lav', 'bg-peach', 'bg-cyan'] as const;

// Chat lives in a right-rail sidebar of the calendar view now (PR-B); the
// standalone 'chat' tab is gone.
type ViewTab = 'list' | 'calendar';
// List can show every group's candidates flat, or split into group sections.
type ListMode = 'all' | 'grouped';
type SortDir = 'asc' | 'desc';
// Sort key is one of the fixed columns or a dynamic `field:<key>`.
type SortKey = '' | 'name' | 'contact' | 'email' | 'slot' | `field:${string}`;

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
  projects,
  selectedProjectId,
  groups,
  candidates,
  slots,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const router = useRouter();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  // Flash feedback now runs through the shared toast layer (BUILD-SPEC §5.6) —
  // the old inline `message` <p> + window.confirm/alert are replaced. Success =
  // neutral 'info' toast, failures = 'warn'.
  const notifyOk = (msg: string) => toast.push(msg, { tone: 'info' });
  const notifyErr = (msg: string) => toast.push(msg, { tone: 'warn' });

  // New-project inline creator (replaces the old two-field batch creator).
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Bulk selection + actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignBatchId, setAssignBatchId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // List controls (PR-C): view segment + field filter + sort.
  const [listMode, setListMode] = useState<ListMode>('all');
  // Which grouped-view (01B) section has its inline rename field open. '' = none.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Captured once at mount — the "upcoming vs past" boundary for the list's
  // 다음 슬롯 column. Reading Date.now() directly in render trips
  // react-hooks/purity; a lazy initializer is the codebase's convention.
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<ViewTab>('list');
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [editorBatchId, setEditorBatchId] = useState('');

  // Which group is in focus for the LIST. '' = 전체 (all groups). Derived below
  // so a project switch (new `groups`) never leaves it on a stale group id.
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // Calendar owns its OWN group filter, independent of the list. The calendar is
  // group-agnostic: it spans every group by default ('' = 전체) and the nested
  // picker only narrows the view. This keeps the calendar a top-level surface
  // rather than something bound to a single group.
  const [calendarGroupId, setCalendarGroupId] = useState('');

  // Chat rail (CD frame 02) is a permanent right column of the calendar tab.
  // `chatThread` is a candidate id or the broadcast sentinel; the chat panel's
  // own reach sub-picker drives thread selection.
  const [chatThread, setChatThread] = useState<string>(BROADCAST_THREAD_ID);

  // The project in focus — its share_token drives the master-link bar.
  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;

  // Groups the user can pick = assignment groups only; the inbox pool stays
  // behind the "전체" option. Ids of every batch (inbox + groups) for scoping.
  const namedGroups = groups.filter((g) => !g.is_inbox);
  const namedGroupIds = new Set(namedGroups.map((g) => g.id));

  // A picked group id that actually exists (and is a named group), or '' for
  // "all" — guards against a stale id lingering after a project switch.
  const effectiveGroupId = namedGroups.some((g) => g.id === selectedGroupId)
    ? selectedGroupId
    : '';
  // Calendar filter, validated against existing named groups; '' = 전체 (span
  // all groups). Independent of the list's `effectiveGroupId`.
  const effectiveCalendarGroupId = namedGroups.some(
    (g) => g.id === calendarGroupId,
  )
    ? calendarGroupId
    : '';
  // A concrete batch id the calendar can hand to batch-scoped children (chat,
  // title, slot create). Falls back to the first batch when spanning all groups.
  const activeCalendarGroupId = effectiveCalendarGroupId || (groups[0]?.id ?? '');

  // Extra (non email/name/phone) columns present across the project, preserved
  // in `fields`. Union so a candidate missing a key still renders an empty cell.
  const fieldColumns = useMemo(
    () =>
      Array.from(
        new Set(candidates.flatMap((c) => Object.keys(c.fields))),
      ).sort(),
    [candidates],
  );

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

  function selectProject(id: string) {
    router.push(`/admin/recruiting-scheduling?project=${id}`);
  }

  // --- Filtering + sorting (client-side, spec §4) ---

  // Distinct values of the chosen filter field, for the value picker.
  const filterValues = useMemo(() => {
    if (!filterKey) return [];
    return Array.from(
      new Set(
        candidates
          .map((c) => c.fields[filterKey])
          .filter((v): v is string => !!v),
      ),
    ).sort();
  }, [candidates, filterKey]);

  // List scope: only the picked group's candidates, or every group when "all".
  const scopedCandidates = useMemo(
    () =>
      effectiveGroupId
        ? candidates.filter((c) => c.batch_id === effectiveGroupId)
        : candidates,
    [candidates, effectiveGroupId],
  );

  const filteredCandidates = useMemo(() => {
    if (!filterKey || !filterValue) return scopedCandidates;
    return scopedCandidates.filter(
      (c) => (c.fields[filterKey] ?? '') === filterValue,
    );
  }, [scopedCandidates, filterKey, filterValue]);

  const sortedCandidates = useMemo(() => {
    if (!sortKey) return filteredCandidates;
    const numericSlot = sortKey === 'slot';
    const comparable = (c: SchedCandidate): string | number => {
      if (sortKey === 'name') return (c.name ?? '').toLowerCase();
      if (sortKey === 'contact') return (contactValue(c) ?? '').toLowerCase();
      if (sortKey === 'email') return (c.email ?? '').toLowerCase();
      if (sortKey === 'slot') {
        const next = nextSlotForCandidate(c.id, slots, now);
        // No slot sorts last in asc order.
        return next ? new Date(next.start_at).getTime() : Number.MAX_SAFE_INTEGER;
      }
      const key = sortKey.slice('field:'.length);
      return (c.fields[key] ?? '').toLowerCase();
    };
    const arr = [...filteredCandidates];
    arr.sort((a, b) => {
      const av = comparable(a);
      const bv = comparable(b);
      let cmp = 0;
      if (numericSlot) cmp = (av as number) - (bv as number);
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredCandidates, sortKey, sortDir, slots, now]);

  // Group sections (그룹별 목록): a section per assignment group, plus an
  // "미할당" section for candidates still in the inbox pool. When a specific
  // group is picked, only that section shows.
  const sectionGroups = effectiveGroupId
    ? namedGroups.filter((g) => g.id === effectiveGroupId)
    : namedGroups;
  const groupSections = sectionGroups.map((g) => ({
    key: g.id,
    title: g.title,
    rows: sortedCandidates.filter((c) => c.batch_id === g.id),
  }));
  // Ungrouped remainder (inbox) — only in the "all" view.
  const ungroupedRows = effectiveGroupId
    ? []
    : sortedCandidates.filter((c) => !namedGroupIds.has(c.batch_id));
  const allSections = ungroupedRows.length
    ? [
        ...groupSections,
        { key: '__ungrouped__', title: t('ungrouped'), rows: ungroupedRows },
      ]
    : groupSections;

  // --- Selection (operates on the visible/sorted list) ---

  const visibleAllSelected =
    sortedCandidates.length > 0 &&
    sortedCandidates.every((c) => selected.has(c.id));

  function rowsAllSelected(rows: SchedCandidate[]): boolean {
    return rows.length > 0 && rows.every((c) => selected.has(c.id));
  }

  function toggleRows(rows: SchedCandidate[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = rows.length > 0 && rows.every((c) => next.has(c.id));
      for (const c of rows) {
        if (all) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
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

  // --- Project + group creation / source ingestion ---

  async function createProject() {
    const title = newProjectTitle.trim();
    if (!title || creatingProject) return;
    setCreatingProject(true);
    try {
      const res = await fetch('/api/scheduling/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        notifyErr(t('projectCreateFailed'));
        return;
      }
      const { project } = (await res.json()) as { project: SchedProject };
      setNewProjectTitle('');
      setShowNewProject(false);
      router.push(`/admin/recruiting-scheduling?project=${project.id}`);
      router.refresh();
    } finally {
      setCreatingProject(false);
    }
  }

  // Uploads/imports land candidates in the project's inbox pool (not a new
  // group per upload) — groups are made later by assigning list-checked
  // candidates. Resolve (create-if-missing) the inbox batch id here.
  async function resolveInbox(): Promise<string | null> {
    if (!selectedProjectId) return null;
    const res = await fetch(
      `/api/scheduling/projects/${selectedProjectId}/inbox`,
      { method: 'POST' },
    );
    if (!res.ok) return null;
    const { batch } = (await res.json()) as { batch: SchedBatch };
    return batch.id;
  }

  async function uploadFile(file: File) {
    if (!selectedProjectId || uploading) return;
    setUploading(true);
    try {
      const batchId = await resolveInbox();
      if (!batchId) {
        notifyErr(t('createFailed'));
        return;
      }
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/scheduling/batches/${batchId}/upload`, {
        method: 'POST',
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
      };
      if (!res.ok) {
        notifyErr(
          json.error === 'no_candidates' ? t('noCandidates') : t('uploadFailed'),
        );
        return;
      }
      notifyOk(t('uploaded', { count: json.upserted ?? 0 }));
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function importSheet() {
    const url = sheetUrl.trim();
    if (!url || !selectedProjectId || importing) return;
    setImporting(true);
    try {
      const batchId = await resolveInbox();
      if (!batchId) {
        notifyErr(t('createFailed'));
        return;
      }
      const res = await fetch(
        `/api/scheduling/batches/${batchId}/import-sheet`,
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
        notifyOk(t('sheetsConnectPrompt'));
        window.location.href = '/api/recruiting/google/start?share=1';
        return;
      }
      if (!res.ok) {
        notifyErr(sheetErrorMessage(json.error));
        return;
      }
      notifyOk(t('uploaded', { count: json.upserted ?? 0 }));
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
        notifyErr(t('bulkConfirmFailed'));
        return;
      }
      notifyOk(t('bulkConfirmed', { count: json.updated ?? 0 }));
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
    try {
      const res = await fetch('/api/scheduling/candidates/assign-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateIds: [...selected],
          // Keep a freshly-created target group inside the current project.
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
          ...(title ? { newBatchTitle: title } : { batchId: assignBatchId }),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        moved?: number;
        batchId?: string;
        error?: string;
      };
      if (!res.ok) {
        notifyErr(
          json.error === 'duplicate_in_target'
            ? t('bulkDuplicateInTarget')
            : t('bulkAssignFailed'),
        );
        return;
      }
      clearSelection();
      // Moved candidates stay in the project (just a different group), so a
      // refresh reflects the new grouping in place.
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // --- Slot editor wiring ---

  function openCreate(start?: Date, candidateId?: string) {
    const base = start ?? roundToNextHalfHour(new Date());
    const end = new Date(base.getTime() + 30 * 60 * 1000);
    // A candidate row schedules into that candidate's group; a blank calendar
    // create uses the calendar's active group.
    const cand = candidateId
      ? candidates.find((c) => c.id === candidateId)
      : null;
    setEditorBatchId(cand?.batch_id ?? effectiveCalendarGroupId);
    setDraft({
      mode: 'individual',
      title: '',
      candidateId: candidateId ?? '',
      startLocal: toLocalInputValue(base.toISOString()),
      endLocal: toLocalInputValue(end.toISOString()),
      status: 'proposed',
      location: '',
      note: '',
    });
    setEditorOpen(true);
  }

  function openEdit(slot: SchedSlot) {
    setEditorBatchId(slot.batch_id ?? effectiveCalendarGroupId);
    setDraft({
      id: slot.id,
      mode: 'individual',
      title: slot.title ?? '',
      candidateId: slot.candidate_id ?? '',
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

  // --- Calendar scoping ---
  // The calendar spans every group by default ('' = 전체); the nested filter
  // narrows it to one group. No single-group special-case is needed — 전체
  // already shows every slot, including narrow-fallback rows with a null batch.
  const calendarSlots = effectiveCalendarGroupId
    ? slots.filter((s) => s.batch_id === effectiveCalendarGroupId)
    : slots;
  // The editor's candidate list / overlap check follow the batch being created
  // into (a candidate's own group, or the calendar filter); '' spans all.
  const editorSlots = editorBatchId
    ? slots.filter((s) => s.batch_id === editorBatchId)
    : slots;
  const editorCandidates = editorBatchId
    ? candidates.filter((c) => c.batch_id === editorBatchId)
    : candidates;

  const editorCandidateOptions = editorCandidates.map((c) => ({
    id: c.id,
    label: candidateLabel(c),
  }));

  // The group whose title heads the calendar — only when a specific group is
  // filtered (전체 has no single title).
  const currentGroup =
    groups.find((g) => g.id === effectiveCalendarGroupId) ?? null;

  // Chat is inherently per-group. In 전체 mode a per-candidate thread resolves to
  // that candidate's own group; broadcast (and the fallback) uses the calendar's
  // resolved batch. Chat's roster is scoped to that same batch for coherence.
  const chatCandidate =
    chatThread && chatThread !== BROADCAST_THREAD_ID
      ? (candidates.find((c) => c.id === chatThread) ?? null)
      : null;
  const chatBatchId = chatCandidate?.batch_id ?? activeCalendarGroupId;
  const chatCandidateOptions = candidates
    .filter((c) => c.batch_id === chatBatchId)
    .map((c) => ({ id: c.id, label: candidateLabel(c) }));
  // Every assignment group + its active-candidate count — feeds the slot
  // editor's group-mode picker so fan-out can target any group. Non-cancelled
  // only, mirroring the server-side fan-out filter.
  const groupModeOptions = namedGroups.map((g) => ({
    id: g.id,
    name: g.title,
    count: candidates.filter(
      (c) => c.batch_id === g.id && c.status !== 'cancelled',
    ).length,
  }));

  // Move targets = existing assignment groups (not the inbox pool).
  const assignBatchOptions = [
    { value: '', label: t('bulkChooseGroup') },
    ...namedGroups.map((g) => ({ value: g.id, label: g.title })),
  ];

  const filterKeyOptions = [
    { value: '', label: t('filterNone') },
    ...fieldColumns.map((k) => ({ value: k, label: k })),
  ];
  const filterValueOptions = [
    { value: '', label: t('filterAnyValue') },
    ...filterValues.map((v) => ({ value: v, label: v })),
  ];
  const sortKeyOptions = [
    { value: '', label: t('sortNone') },
    { value: 'name', label: t('colName') },
    { value: 'contact', label: t('colContact') },
    { value: 'email', label: t('colEmail') },
    { value: 'slot', label: t('colSlot') },
    ...fieldColumns.map((k) => ({ value: `field:${k}`, label: k })),
  ];

  // One table body, shared by the flat and grouped views. `rows` is already
  // filtered + sorted; the header checkbox toggles exactly these rows. Memphis
  // skin (BUILD-SPEC §1): 2px ink framed card, mono uppercase header on
  // paper-soft, sticky-3col geometry preserved (CONTEXTFORCD §5.9). The
  // per-candidate share-link column is gone — the link is one project-shared
  // master link now (BUILD-SPEC §5.1).
  function renderTable(rows: SchedCandidate[], framed = true) {
    const body = (
      <div className="overflow-x-auto">
          {/* border-separate (not collapse): under border-collapse, z-index on
              sticky <td> is ignored in Chrome so scrolling columns bleed through
              the frozen ones. Row borders move onto the cells via thead/tbody
              variants since <tr> borders don't paint in separate mode. */}
          <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-sm">
            <thead className="[&_th]:border-b-2 [&_th]:border-ink [&_th]:bg-paper-soft [&_th]:font-mono [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-mute-soft">
              <tr className="text-left">
                <th
                  className="sticky z-table-cell-sticky px-3 py-2.5"
                  style={stickyStyle(STICKY_LEFT.check, STICKY_W.check)}
                >
                  <Checkbox
                    aria-label={t('selectAll')}
                    checked={rowsAllSelected(rows)}
                    onChange={() => toggleRows(rows)}
                  />
                </th>
                <th
                  className="sticky z-table-cell-sticky px-3.5 py-2.5"
                  style={stickyStyle(STICKY_LEFT.name, STICKY_W.name)}
                >
                  {t('colName')}
                </th>
                <th
                  className="sticky z-table-cell-sticky border-r-2 border-ink px-3.5 py-2.5"
                  style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                >
                  {t('colContact')}
                </th>
                <th className="px-4 py-2.5">{t('colEmail')}</th>
                {fieldColumns.map((col) => (
                  <th key={col} className="px-4 py-2.5">
                    {col}
                  </th>
                ))}
                <th className="px-4 py-2.5">{t('colSlot')}</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-line-soft">
              {rows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-center text-mute"
                    colSpan={5 + fieldColumns.length}
                  >
                    {t('emptyCandidates')}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const next = nextSlotForCandidate(c.id, slots, now);
                  const checked = selected.has(c.id);
                  const contact = contactValue(c);
                  return (
                    <tr key={c.id} className="group">
                      <td
                        className="sticky z-table-cell-sticky bg-paper px-3 py-2.5 transition-colors group-hover:bg-paper-soft"
                        style={stickyStyle(STICKY_LEFT.check, STICKY_W.check)}
                      >
                        <Checkbox
                          aria-label={t('selectRow')}
                          checked={checked}
                          onChange={() => toggleOne(c.id)}
                        />
                      </td>
                      <td
                        className="sticky z-table-cell-sticky bg-paper px-3.5 py-2.5 text-ink transition-colors group-hover:bg-paper-soft"
                        style={stickyStyle(STICKY_LEFT.name, STICKY_W.name)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="truncate font-bold"
                            title={c.name ?? undefined}
                          >
                            {c.name ?? '—'}
                          </span>
                          {c.status === 'confirmed' && (
                            <span className="shrink-0 rounded-xs border border-success/30 bg-success-soft px-1.5 py-px text-xs font-extrabold text-success">
                              {t('confirmedChip')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className="sticky z-table-cell-sticky border-r-2 border-ink bg-paper px-3.5 py-2.5 font-mono text-md text-ink-2 transition-colors group-hover:bg-paper-soft"
                        style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                      >
                        <div className="truncate" title={contact ?? undefined}>
                          {contact ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-mute">
                        <div
                          className="truncate"
                          style={{ maxWidth: DATA_CELL_MAX }}
                          title={c.email ?? undefined}
                        >
                          {c.email ?? '—'}
                        </div>
                      </td>
                      {fieldColumns.map((col) => (
                        <td key={col} className="px-4 py-2.5 text-mute">
                          <div
                            className="truncate"
                            style={{ maxWidth: DATA_CELL_MAX }}
                            title={c.fields[col] || undefined}
                          >
                            {c.fields[col] || ''}
                          </div>
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        {next ? (
                          <Button
                            variant="link"
                            size="xs"
                            onClick={() => openEdit(next)}
                          >
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`inline-block h-2 w-2 shrink-0 rounded-full ${slotDotClass(next.status)}`}
                              />
                              <span className="font-bold">
                                {slotTimeFmt.format(new Date(next.start_at))}
                              </span>
                              <span className="text-mute-soft">
                                · {statusLabel[next.status]}
                              </span>
                            </span>
                          </Button>
                        ) : (
                          // eslint-disable-next-line react/forbid-elements -- CD dashed "assign" pill (frame 01); Button chrome (solid border/shadow/radius) unsuitable for the ghost dashed-outline treatment
                          <button
                            type="button"
                            onClick={() => openCreate(undefined, c.id)}
                            className="inline-flex items-center gap-1.5 rounded-pill border border-dashed border-line px-2.5 py-1 text-sm text-mute transition-colors hover:border-ink hover:text-ink"
                          >
                            {t('assignSlot')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
          </tbody>
        </table>
      </div>
    );
    // Grouped sections (01B) supply their own Memphis card frame, so the table
    // renders unframed inside them; the flat "all" view frames it here.
    return framed ? (
      <div className="overflow-hidden rounded-sm border-2 border-ink shadow-memphis-md">
        {body}
      </div>
    ) : (
      body
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1360px] p-6">
      {/* Memphis screen frame (BUILD-SPEC §1) — 3px ink · radius 14 · hard 8px
          offset shadow. This establishes the redesign client shell (frame + sun
          header + project pill + view tabs) that the calendar/chat specs build
          on. Legacy flat editorial (1px border-line / shadow-0) is replaced. */}
      <div className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper-soft shadow-memphis-2xl">
        {/* Sun header band — recruiting widget identity (WIDGET-SHELL §S3, sun).
            Tone + Outfit display consumed via CSS var (the sanctioned shell
            pattern — no bg/font utility exists for these), mirroring the canvas
            fullview panel. */}
        <header
          className="flex flex-wrap items-center gap-3 border-b-[3px] border-ink px-[26px] py-[15px]"
          style={{ background: 'var(--widget-header-bg-sun)' }}
        >
          <span className="text-2xl" aria-hidden>
            🧲
          </span>
          <h1
            className="min-w-0 flex-1 truncate text-ink"
            style={{
              fontFamily: 'var(--font-outfit), var(--font-sans)',
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: '-0.5px',
            }}
          >
            {t('title')}
          </h1>
          <SegmentedControl
            ariaLabel={t('viewTabsLabel')}
            value={tab}
            onChange={(v) => setTab(v as ViewTab)}
            options={[
              { value: 'list', label: t('tabList') },
              { value: 'calendar', label: t('tabCalendar') },
            ]}
          />
          {/* Project pill (dropdown) — full-nav project switch. */}
          <div className="min-w-[180px]">
            <Select
              aria-label={t('projectLabel')}
              size="sm"
              fullWidth={false}
              className="w-full"
              value={selectedProjectId ?? ''}
              onChange={(e) => selectProject(e.target.value)}
              options={projects.map((p) => ({ value: p.id, label: p.title }))}
              disabled={projects.length === 0}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowNewProject((v) => !v)}
          >
            {t('newProjectCta')}
          </Button>
        </header>

        <div className="flex flex-col gap-5 p-[26px]">
          {/* Inline new-project creator — revealed by the header "+ New
              project" pill. */}
          {showNewProject && (
            <div className="flex flex-wrap items-end gap-2 rounded-sm border-2 border-ink bg-paper p-4 shadow-memphis-sm">
              <Input
                label={t('newProjectLabel')}
                placeholder={t('newProjectPlaceholder')}
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createProject();
                }}
              />
              <Button
                variant="primary"
                onClick={createProject}
                disabled={!newProjectTitle.trim() || creatingProject}
              >
                {creatingProject ? t('creating') : t('create')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowNewProject(false);
                  setNewProjectTitle('');
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          )}

          {selectedProjectId ? (
            <>
              {/* Source intake 2-up (spec §2) — CSV/XLSX dropzone (already
                  Memphis) + Google Sheets card. Candidates land in the inbox
                  pool; groups are made by assigning list-checked candidates. */}
              <div>
                <div className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-mute-soft">
                  {t('loadCandidates')}
                </div>
                <div className="flex flex-col gap-4 md:flex-row">
                  <FileDropZone
                    accept=".csv,.xlsx"
                    maxSizeBytes={MAX_UPLOAD_BYTES}
                    disabled={uploading}
                    onFiles={(files) => {
                      if (files[0]) uploadFile(files[0]);
                    }}
                    onError={() => notifyErr(t('fileTooLarge'))}
                    label={uploading ? t('uploading') : t('uploadLabel')}
                    helperText={t('uploadHelper')}
                    className="flex-1 px-6 py-10"
                  />
                  <div className="flex flex-1 flex-col gap-3 rounded-sm border-2 border-ink bg-paper px-5 py-4 shadow-memphis-sm">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-mint text-base"
                        aria-hidden
                      >
                        📗
                      </span>
                      <p
                        className="text-lg font-extrabold text-ink"
                        style={{
                          fontFamily: 'var(--font-outfit), var(--font-sans)',
                        }}
                      >
                        {t('sheetsTitle')}
                      </p>
                    </div>
                    <p className="text-md leading-relaxed text-mute">
                      {t('sheetsHelper')}
                    </p>
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label={t('sheetsUrlLabel')}
                          placeholder={t('sheetsUrlPlaceholder')}
                          value={sheetUrl}
                          onChange={(e) => setSheetUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') importSheet();
                          }}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={importSheet}
                        disabled={importing || !sheetUrl.trim()}
                      >
                        {importing ? t('sheetsImporting') : t('sheetsImport')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Master schedule link bar (BUILD-SPEC §5.1) — one project-shared
                  link, replacing the per-candidate share column. Hidden when the
                  DB has no share_token yet (preview before migration). */}
              {selectedProject?.share_token && (
                <MasterLinkBar
                  shareToken={selectedProject.share_token}
                  onCopied={() => notifyOk(t('masterLinkCopied'))}
                />
              )}

              {tab === 'list' ? (
            <>
              {/* All/By-group segment + group scope + filter + sort + add slot
                  (spec §3, §4). The All/By-group toggle lives in the list
                  controls (frame 01); the top-level List/Calendar toggle lives
                  in the header. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y-2 border-line-soft py-3">
                <SegmentedControl
                  ariaLabel={t('listModeLabel')}
                  value={listMode}
                  onChange={(v) => setListMode(v as ListMode)}
                  options={[
                    { value: 'all', label: t('listModeAll') },
                    { value: 'grouped', label: t('listModeGrouped') },
                  ]}
                />
                {namedGroups.length > 0 && (
                  <Select
                    aria-label={t('groupPickerLabel')}
                    size="sm"
                    fullWidth={false}
                    className="w-40 truncate"
                    value={effectiveGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    options={[
                      { value: '', label: t('groupAll') },
                      ...namedGroups.map((g) => ({
                        value: g.id,
                        label: g.title,
                      })),
                    ]}
                  />
                )}
                <label className="flex items-center gap-2 text-sm text-ink">
                  <Checkbox
                    aria-label={t('selectAll')}
                    checked={visibleAllSelected}
                    onChange={() => toggleRows(sortedCandidates)}
                  />
                  {t('selectAll')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap text-sm text-mute">
                    {t('filterLabel')}
                  </span>
                  <Select
                    aria-label={t('filterLabel')}
                    size="sm"
                    fullWidth={false}
                    className="w-44 truncate"
                    value={filterKey}
                    onChange={(e) => {
                      setFilterKey(e.target.value);
                      setFilterValue('');
                    }}
                    options={filterKeyOptions}
                    disabled={fieldColumns.length === 0}
                  />
                  {filterKey && (
                    <Select
                      aria-label={t('filterAnyValue')}
                      size="sm"
                      fullWidth={false}
                      className="w-44 truncate"
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      options={filterValueOptions}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap text-sm text-mute">
                    {t('sortLabel')}
                  </span>
                  <Select
                    aria-label={t('sortLabel')}
                    size="sm"
                    fullWidth={false}
                    className="w-44 truncate"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    options={sortKeyOptions}
                  />
                  {sortKey && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                      }
                    >
                      {sortDir === 'asc' ? t('sortAsc') : t('sortDesc')}
                    </Button>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="ml-auto"
                  onClick={() => openCreate()}
                >
                  {t('slotAdd')}
                </Button>
              </div>

              {/* Bulk action bar (BUILD-SPEC §1) — amber warning surface + amber
                  hard shadow when rows are selected. */}
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border-2 border-ink bg-warning-bg px-4 py-3 shadow-memphis-md-amber">
                  <span className="text-md font-extrabold text-ink">
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
                        label={t('bulkNewGroup')}
                        placeholder={t('newGroupPlaceholder')}
                        value={assignTitle}
                        onChange={(e) => setAssignTitle(e.target.value)}
                      />
                      <span className="pb-2 text-sm text-mute">{t('bulkOr')}</span>
                      <div className="min-w-[200px]">
                        <Select
                          label={t('bulkExistingGroup')}
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

              {listMode === 'all' ? (
                renderTable(sortedCandidates)
              ) : (
                // By-group view (01B): a Memphis card per section — pastel-tinted
                // head (name + count pill + Rename) over the roster table. The
                // "미할당"(inbox) section heads neutral; its rows are assigned via
                // the bulk bar (select → Send to group).
                <div className="flex flex-col gap-4">
                  {allSections.length === 0 ? (
                    <p className="text-md text-mute">{t('emptyGroups')}</p>
                  ) : (
                    allSections.map(({ key, title, rows }, i) => {
                      const isInbox = key === '__ungrouped__';
                      return (
                        <div
                          key={key}
                          className="overflow-hidden rounded-sm border-2 border-ink shadow-memphis-md"
                        >
                          <div
                            className={`flex flex-wrap items-center gap-3 border-b-2 border-ink px-4 py-3 ${
                              isInbox
                                ? 'bg-paper-soft'
                                : HEAD_TINTS[i % HEAD_TINTS.length]
                            }`}
                          >
                            <span className="text-base" aria-hidden>
                              {isInbox ? '📥' : '📁'}
                            </span>
                            {!isInbox && renamingKey === key ? (
                              <div className="min-w-[220px] flex-1">
                                <BatchTitleField
                                  key={key}
                                  batchId={key}
                                  title={title}
                                  onSaved={() => {
                                    setRenamingKey(null);
                                    router.refresh();
                                  }}
                                />
                              </div>
                            ) : (
                              <span
                                className="min-w-0 flex-1 truncate font-extrabold text-ink"
                                style={{
                                  fontFamily:
                                    'var(--font-outfit), var(--font-sans)',
                                  fontSize: 16,
                                }}
                              >
                                {title}
                              </span>
                            )}
                            <span className="shrink-0 rounded-pill border-[1.4px] border-ink bg-paper px-2.5 py-0.5 font-mono text-sm font-bold text-ink-2">
                              {rows.length}
                            </span>
                            {!isInbox && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() =>
                                  setRenamingKey((k) => (k === key ? null : key))
                                }
                              >
                                {t('groupRename')}
                              </Button>
                            )}
                          </div>
                          {renderTable(rows, false)}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </>
          ) : (
            // Unified calendar view (CD frame 02) — one Memphis two-pane card:
            // colored-time-block calendar (left) + a permanent chat rail (396px,
            // right). The calendar spans every group by default ('' = 전체); the
            // in-toolbar Group pill narrows it. A filtered group still surfaces
            // its editable title above the card (BatchTitleField contract).
            <div className="flex flex-col gap-4">
              {effectiveCalendarGroupId && (
                <div className="max-w-md">
                  <BatchTitleField
                    key={effectiveCalendarGroupId}
                    batchId={effectiveCalendarGroupId}
                    title={currentGroup?.title ?? ''}
                    onSaved={() => router.refresh()}
                  />
                </div>
              )}

              <div className="flex flex-col overflow-hidden rounded-sm border-2 border-ink shadow-memphis-md lg:h-[680px] lg:flex-row">
                <SchedulingCalendar
                  slots={calendarSlots}
                  candidateName={(id) =>
                    candidateNameById.get(id) ?? t('unnamedCandidate')
                  }
                  view={calendarView}
                  onViewChange={setCalendarView}
                  onCreateAt={(start) => openCreate(start)}
                  onEditSlot={openEdit}
                  groupFilter={
                    namedGroups.length > 0
                      ? {
                          ariaLabel: t('calendarGroupLabel'),
                          value: effectiveCalendarGroupId,
                          onChange: setCalendarGroupId,
                          options: [
                            { value: '', label: t('groupAll') },
                            ...namedGroups.map((g) => ({
                              value: g.id,
                              label: g.title,
                            })),
                          ],
                        }
                      : undefined
                  }
                />

                {/* Permanent chat rail — CD frame 02 border-between the panes. */}
                {chatBatchId && (
                  <aside className="flex min-h-[540px] flex-col border-t-[3px] border-ink lg:min-h-0 lg:w-[396px] lg:shrink-0 lg:border-l-[3px] lg:border-t-0">
                    <SchedulingChatPanel
                      batchId={chatBatchId}
                      candidates={chatCandidateOptions}
                      groups={namedGroups.map((g) => ({
                        id: g.id,
                        title: g.title,
                      }))}
                      layout="sidebar"
                      selectedThread={chatThread}
                      onSelectThread={setChatThread}
                      totalCount={candidates.length}
                      // 일정 패널 소스 — the full slot set so the panel's own
                      // scope filter (전체/그룹/개인) resolves any target, not just
                      // the calendar's currently-filtered group. Click → openEdit.
                      slots={slots}
                      onEditSlot={openEdit}
                    />
                  </aside>
                )}
              </div>
            </div>
          )}
            </>
          ) : (
            <p className="text-md text-mute">{t('selectProjectFirst')}</p>
          )}
        </div>
      </div>

      <SlotEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        draft={draft}
        candidates={editorCandidateOptions}
        batchId={editorBatchId}
        groupOptions={groupModeOptions}
        allSlots={editorSlots}
        onSaved={onSaved}
      />
    </div>
  );
}

// Inline free-text calendar title (spec §1, PR-B). The group (batch) title
// doubles as the calendar heading; edits save immediately on blur or Enter via
// PATCH. Keyed on the group id in the parent so a group switch reseeds it.
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
    // No-op on empty or unchanged — keeps the group from being blanked out and
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

// Master schedule link bar (BUILD-SPEC §5.1) — one project-shared link that
// replaces the per-candidate ShareLinkCell. The relative `/schedule/<token>` is
// shown in the field (no origin → no hydration mismatch); the absolute URL is
// built from window.location.origin at copy time so it matches the deployment.
function MasterLinkBar({
  shareToken,
  onCopied,
}: {
  shareToken: string;
  onCopied: () => void;
}) {
  const t = useTranslations('RecruitingScheduling');
  const relative = `/schedule/${shareToken}`;

  async function copy() {
    const abs =
      typeof window !== 'undefined'
        ? `${window.location.origin}${relative}`
        : relative;
    try {
      await navigator.clipboard.writeText(abs);
      onCopied();
    } catch {
      // Clipboard blocked (insecure context / permission) — no-op; the admin
      // can still read the URL from the field.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border-2 border-ink bg-sky px-4 py-3 shadow-memphis-md">
      <span className="text-lg" aria-hidden>
        🔗
      </span>
      <div className="min-w-0">
        <div className="text-md font-extrabold text-ink">
          {t('masterLinkTitle')}
        </div>
        <div className="text-sm text-mute">{t('masterLinkHelper')}</div>
      </div>
      <div className="min-w-[180px] flex-1 truncate rounded-[var(--fv-radius-field)] border-[1.5px] border-ink bg-paper px-3 py-2 font-mono text-md text-ink">
        {relative}
      </div>
      <Button variant="secondary" size="sm" onClick={copy}>
        {t('masterLinkCopy')}
      </Button>
    </div>
  );
}

// Memphis segmented control (BUILD-SPEC §1) — pill container with an ink-fill
// active segment. The editorial <Tabs> primitive is an underline tab (flat), so
// a fresh Memphis pill is built here per CD (AUTHORITY: don't downgrade to the
// flat primitive). role=tablist/tab keeps it AT-legible.
function SegmentedControl<T extends string>({
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
          // eslint-disable-next-line react/forbid-elements -- CD Memphis segmented pill (ink-fill active seg); the Button primitive's per-button border/shadow/radius can't compose into one unified segmented control
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={[
              'px-4 py-1.5 text-md font-bold transition-colors',
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

// Next-slot dot color by status — binds the recsched slot-status tokens
// (globals.css §2, BUILD-SPEC §2) rather than raw signal colors.
function slotDotClass(status: SlotStatus): string {
  return status === 'confirmed'
    ? 'bg-slot-confirmed-dot'
    : status === 'cancelled'
      ? 'bg-slot-cancelled-dot'
      : 'bg-slot-proposed-dot';
}
