'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyCandidatesTab — recruiting 저니 셸 탭② 명단(Candidates) 본문 (CD N2).

   scheduling "리스트 뷰"를 풀뷰 안으로 re-home(HANDOFF: 기존 recsched 리스트
   구현이 그 자체로 CD Memphis → 로직/표현 이식, 재구현 금지). 웨이브1 골격
   (EmptyState) 을 대체한다. 캘린더/채팅/슬롯 편집은 탭③(일정) 소유 — 여기엔
   슬롯 컬럼/에디터 없음(spec §2 컬럼셋 = check·이름·연락처·소스·이메일·동적
   fields, "다음 슬롯" 명시 제외).

   소스 3-up(N2): 응답연동(읽기전용 카운트🔒) · CSV 업로드 · Google Sheets
   (+R9 "연동됨 카드" — source_sheet_url/title/synced_at 승계·재동기화·재연결).
   듀얼 PII: 브리지분 연락처는 서버 마스킹(●●●●·🔒, candidate-masking.ts) →
   클라는 마스킹된 값을 그대로 렌더(클라 마스킹 금지, spec §제약). 소스 컬럼
   🧲/📄/📗 + footer 레전드.

   데이터: form-anchored 저니 엔드포인트(GET /journey/candidates)에서
   candidates(소스별 마스킹)·batches·inbox_batch_id·project(source_sheet)를
   한 번에 받는다. 변이는 기존 scheduling 액션 라우트 재사용(upsert·409·상태
   시맨틱 회귀 0) + 성공 시 로컬 refetch(풀뷰 내부 → router.refresh 아님).
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/toast-provider';
import { CONTACT_MASK } from '@/lib/scheduling/candidate-masking';

// Journey read shape (from GET /api/scheduling/journey/candidates). `source` is
// additive → may be null (legacy = plaintext). Contact fields arrive already
// server-masked for bridge rows (●●●●), so the client never handles raw PII.
type JourneyCandidate = {
  id: string;
  batch_id: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string> | null;
  status: string;
  source: string | null;
};
type JourneyBatch = { id: string; title: string; is_inbox: boolean };
type JourneyProject = {
  id: string;
  title: string;
  source_sheet_url: string | null;
  source_sheet_title: string | null;
  source_sheet_synced_at: string | null;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Pastel tints cycled across By-group (R1/01B) section heads. Inbox head neutral.
const HEAD_TINTS = ['bg-sky', 'bg-mint', 'bg-lav', 'bg-peach', 'bg-cyan'] as const;

type CandidateStatus = 'pending' | 'confirmed' | 'communicating';
type ListMode = 'all' | 'grouped';
type SortDir = 'asc' | 'desc';
// No slot sort in the 명단 tab (slots live in 탭③).
type SortKey = '' | 'name' | 'contact' | 'email' | `field:${string}`;

// Sticky-3col geometry — preserved exactly (CONTEXTRECSCHED A.2.5 / BUILD-SPEC
// §1: check 44 / name 168 / contact 184). Source is the first scrollable column.
const STICKY_W = { check: 44, name: 168, contact: 184 };
const STICKY_LEFT = {
  check: 0,
  name: STICKY_W.check,
  contact: STICKY_W.check + STICKY_W.name,
};
const DATA_CELL_MAX = 240;

function stickyStyle(left: number, w: number): CSSProperties {
  return { left, width: w, minWidth: w, maxWidth: w };
}

export function JourneyCandidatesTab({ formId }: { formId: string | null }) {
  const t = useTranslations('RecruitingScheduling');
  const tj = useTranslations('Recruiting.journey');
  const toast = useToast();
  const notifyOk = (msg: string) => toast.push(msg, { tone: 'info' });
  const notifyErr = (msg: string) => toast.push(msg, { tone: 'warn' });

  // --- Journey data (form-anchored) -------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [project, setProject] = useState<JourneyProject | null>(null);
  const [candidates, setCandidates] = useState<JourneyCandidate[]>([]);
  const [batches, setBatches] = useState<JourneyBatch[]>([]);
  const [inboxBatchId, setInboxBatchId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!formId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(
        `/api/scheduling/journey/candidates?form_id=${encodeURIComponent(formId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const json = (await res.json()) as {
        project: JourneyProject | null;
        candidates: JourneyCandidate[];
        batches: JourneyBatch[];
        inbox_batch_id: string | null;
      };
      setProject(json.project ?? null);
      setCandidates(json.candidates ?? []);
      setBatches(json.batches ?? []);
      setInboxBatchId(json.inbox_batch_id ?? null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form-anchored fetch-on-mount (load() sets loading/data); re-fetch also runs from handlers
    void load();
  }, [load]);

  // --- Source intake state ----------------------------------------------
  // 소스 3-up 접기 토글 — 기본 오픈(round-2 feedback #5). 명단이 길어지면
  // 접어서 표에 집중할 수 있게 한다.
  const [sourceOpen, setSourceOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  // When a sheet is already linked (R9), the input is hidden behind a "다른
  // 시트 연결" reveal so re-sync/reconnect are the primary affordances.
  const [showSheetInput, setShowSheetInput] = useState(false);

  // --- Bulk selection + list controls -----------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignBatchId, setAssignBatchId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [listMode, setListMode] = useState<ListMode>('all');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [statusFilter, setStatusFilter] = useState<'' | CandidateStatus>('');

  // --- Derived ----------------------------------------------------------
  const namedGroups = useMemo(
    () => batches.filter((b) => !b.is_inbox),
    [batches],
  );
  const namedGroupIds = useMemo(
    () => new Set(namedGroups.map((g) => g.id)),
    [namedGroups],
  );

  const fieldColumns = useMemo(
    () =>
      Array.from(
        new Set(candidates.flatMap((c) => Object.keys(c.fields ?? {}))),
      ).sort(),
    [candidates],
  );

  // Contact = phone first, email fallback (연락처=phone; 없으면 email). For a
  // bridge row this is already the server-masked ●●●● string.
  function contactValue(c: JourneyCandidate): string | null {
    return c.phone || c.email || null;
  }

  const filterValues = useMemo(() => {
    if (!filterKey) return [];
    return Array.from(
      new Set(
        candidates
          .map((c) => c.fields?.[filterKey])
          .filter((v): v is string => !!v),
      ),
    ).sort();
  }, [candidates, filterKey]);

  const scopedCandidates = useMemo(
    () =>
      statusFilter
        ? candidates.filter((c) => c.status === statusFilter)
        : candidates,
    [candidates, statusFilter],
  );

  const filteredCandidates = useMemo(() => {
    if (!filterKey || !filterValue) return scopedCandidates;
    return scopedCandidates.filter(
      (c) => (c.fields?.[filterKey] ?? '') === filterValue,
    );
  }, [scopedCandidates, filterKey, filterValue]);

  const sortedCandidates = useMemo(() => {
    if (!sortKey) return filteredCandidates;
    const comparable = (c: JourneyCandidate): string => {
      if (sortKey === 'name') return (c.name ?? '').toLowerCase();
      if (sortKey === 'contact') return (contactValue(c) ?? '').toLowerCase();
      if (sortKey === 'email') return (c.email ?? '').toLowerCase();
      const key = sortKey.slice('field:'.length);
      return (c.fields?.[key] ?? '').toLowerCase();
    };
    const arr = [...filteredCandidates];
    arr.sort((a, b) => {
      const cmp = comparable(a).localeCompare(comparable(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredCandidates, sortKey, sortDir]);

  // Group sections (R1): a section per assignment group + a 미할당(inbox) pool.
  const groupSections = namedGroups.map((g) => ({
    key: g.id,
    title: g.title,
    rows: sortedCandidates.filter((c) => c.batch_id === g.id),
  }));
  const ungroupedRows = sortedCandidates.filter(
    (c) => !c.batch_id || !namedGroupIds.has(c.batch_id),
  );
  const allSections = ungroupedRows.length
    ? [
        ...groupSections,
        { key: '__ungrouped__', title: t('ungrouped'), rows: ungroupedRows },
      ]
    : groupSections;

  // Linked-source count — 응답 연동 카드의 "브리지 N명" 배지용(레전드는 제거됨,
  // round-2 feedback #6).
  const bridgedCount = candidates.filter((c) => c.source === 'bridge').length;

  const visibleAllSelected =
    sortedCandidates.length > 0 &&
    sortedCandidates.every((c) => selected.has(c.id));

  function rowsAllSelected(rows: JourneyCandidate[]): boolean {
    return rows.length > 0 && rows.every((c) => selected.has(c.id));
  }
  function toggleRows(rows: JourneyCandidate[]) {
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

  // --- Source ingestion (reuse existing scheduling action routes) --------
  async function uploadFile(file: File) {
    if (!inboxBatchId || uploading) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/scheduling/batches/${inboxBatchId}/upload`, {
        method: 'POST',
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
        code?: string | null;
        detail?: string | null;
      };
      if (!res.ok) {
        if (json.error === 'no_candidates') {
          notifyErr(t('noCandidates'));
          return;
        }
        // Surface the real Postgres code + message when the route exposes them
        // (journey R3 #2) so a failing upload is diagnosable instead of the
        // opaque "업로드 실패" — mirrors the bridge Send fail toast (#2a).
        const reason = json.code
          ? `${json.error ?? 'error'} (${json.code}${json.detail ? `: ${json.detail}` : ''})`
          : (json.error ?? String(res.status));
        notifyErr(t('uploadFailedReason', { error: reason }));
        return;
      }
      notifyOk(t('uploaded', { count: json.upserted ?? 0 }));
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function importSheet(url: string) {
    const target = url.trim();
    if (!target || !inboxBatchId || importing) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/scheduling/batches/${inboxBatchId}/import-sheet`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetUrl: target }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        upserted?: number;
        error?: string;
      };
      // Not connected / missing Sheets scope → bounce into the existing
      // recruiting Google OAuth with the Sheets superset (share=1).
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
      setShowSheetInput(false);
      await load();
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

  // Re-sync (R9) = re-run import with the remembered URL. Reconnect = OAuth bounce.
  function resyncSheet() {
    if (project?.source_sheet_url) void importSheet(project.source_sheet_url);
  }
  function reconnectSheet() {
    window.location.href = '/api/recruiting/google/start?share=1';
  }

  // --- Bulk actions (reuse existing routes, local refetch) ---------------
  async function confirmSelected() {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/scheduling/candidates/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as { updated?: number };
      if (!res.ok) {
        notifyErr(t('bulkConfirmFailed'));
        return;
      }
      notifyOk(t('bulkConfirmed', { count: json.updated ?? 0 }));
      clearSelection();
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function communicatingSelected() {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/scheduling/candidates/set-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateIds: [...selected],
          status: 'communicating',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { updated?: number };
      if (!res.ok) {
        notifyErr(t('bulkCommunicatingFailed'));
        return;
      }
      notifyOk(t('bulkCommunicated', { count: json.updated ?? 0 }));
      clearSelection();
      await load();
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
          ...(project?.id ? { projectId: project.id } : {}),
          ...(title ? { newBatchTitle: title } : { batchId: assignBatchId }),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        notifyErr(
          json.error === 'duplicate_in_target'
            ? t('bulkDuplicateInTarget')
            : t('bulkAssignFailed'),
        );
        return;
      }
      clearSelection();
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  // --- Select option groups ---------------------------------------------
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
    ...fieldColumns.map((k) => ({ value: `field:${k}`, label: k })),
  ];

  // Source provenance chip (소스 컬럼) — bridge=🧲 green, upload=📄, sheet=📗.
  // null (legacy) reads as plaintext → upload style.
  function sourceMeta(source: string | null): {
    icon: string;
    label: string;
    cls: string;
  } {
    switch (source) {
      case 'bridge':
        return { icon: '🧲', label: tj('sourceBridge'), cls: 'text-success-text' };
      case 'sheet':
        return { icon: '📗', label: tj('sourceSheet'), cls: 'text-mute-soft' };
      default:
        return { icon: '📄', label: tj('sourceUpload'), cls: 'text-mute-soft' };
    }
  }

  // Shared table body for the flat + grouped views. `rows` is pre-filtered/
  // sorted. Sticky-3col preserved; source column inserted right after contact
  // (first scrollable col), then email + dynamic fields. Dual-PII: a bridge
  // row's contact arrives masked (●●●●) → 🔒 + faint tone (server-enforced).
  function renderTable(rows: JourneyCandidate[], framed = true) {
    const body = (
      <div className="overflow-x-auto">
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
              <th className="px-4 py-2.5">{tj('colSource')}</th>
              <th className="px-4 py-2.5">{t('colEmail')}</th>
              {fieldColumns.map((col) => (
                <th key={col} className="px-4 py-2.5">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:border-b [&_td]:border-line-soft">
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-mute"
                  colSpan={4 + fieldColumns.length}
                >
                  {t('emptyCandidates')}
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const checked = selected.has(c.id);
                const contact = contactValue(c);
                const contactMasked = contact === CONTACT_MASK;
                const emailMasked = c.email === CONTACT_MASK;
                const src = sourceMeta(c.source);
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
                        {c.status === 'communicating' && (
                          <span className="shrink-0 rounded-xs border border-amore/30 bg-amore-bg px-1.5 py-px text-xs font-extrabold text-amore">
                            {t('communicatingChip')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`sticky z-table-cell-sticky border-r-2 border-ink bg-paper px-3.5 py-2.5 font-mono text-md transition-colors group-hover:bg-paper-soft ${
                        contactMasked ? 'text-faint' : 'text-ink-2'
                      }`}
                      style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                    >
                      <div className="truncate" title={contactMasked ? undefined : (contact ?? undefined)}>
                        {contactMasked ? `🔒 ${contact}` : (contact ?? '—')}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold ${src.cls}`}
                      >
                        <span aria-hidden>{src.icon}</span>
                        {src.label}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 ${emailMasked ? 'text-faint' : 'text-mute'}`}
                    >
                      <div
                        className="truncate"
                        style={{ maxWidth: DATA_CELL_MAX }}
                        title={emailMasked ? undefined : (c.email ?? undefined)}
                      >
                        {c.email ?? '—'}
                      </div>
                    </td>
                    {fieldColumns.map((col) => (
                      <td key={col} className="px-4 py-2.5 text-mute">
                        <div
                          className="truncate"
                          style={{ maxWidth: DATA_CELL_MAX }}
                          title={c.fields?.[col] || undefined}
                        >
                          {c.fields?.[col] || ''}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
    return framed ? (
      <div className="overflow-hidden rounded-sm border-2 border-ink shadow-memphis-md">
        {body}
      </div>
    ) : (
      body
    );
  }

  // --- Empty / loading / error gates ------------------------------------
  if (!formId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
        <EmptyState
          tone="subtle"
          icon={<span className="text-3xl">📋</span>}
          title={tj('noFormTitle')}
          description={tj('noFormDesc')}
        />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="h-24 animate-pulse rounded-sm border-2 border-line-soft bg-paper-soft" />
        <div className="h-64 animate-pulse rounded-sm border-2 border-line-soft bg-paper-soft" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
        <EmptyState
          tone="subtle"
          icon={<span className="text-3xl">⚠️</span>}
          title={tj('loadError')}
          description=""
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {tj('retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const sheetLinked = !!project?.source_sheet_url;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      {/* Source intake 3-up (N2) — 응답 연동(읽기전용) · CSV 업로드 · Sheets.
          접기 토글, 기본 오픈(round-2 feedback #5). */}
      <div>
        {/* eslint-disable-next-line react/forbid-elements -- 인라인 접기 토글(mono 라벨 + 셰브론) — Button primitive 의 border/radius chrome 과 불일치(§7.11). 저니 셸 접기 조각과 동일 선례. */}
        <button
          type="button"
          onClick={() => setSourceOpen((v) => !v)}
          aria-expanded={sourceOpen}
          className="mb-3 flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-mute-soft transition-colors hover:text-ink"
        >
          <span aria-hidden className="text-xs leading-none">
            {sourceOpen ? '▼' : '▶'}
          </span>
          {t('loadCandidates')}
        </button>
        {sourceOpen && (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {/* 1. 응답에서 연동 — mint linked card, read-only (브리지는 ① 탭에서). */}
          <div className="flex flex-col gap-2 rounded-sm border-2 border-ink bg-success-bg p-4 shadow-memphis-sm">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-paper text-base"
                aria-hidden
              >
                🧲
              </span>
              <span
                className="text-md font-extrabold text-ink"
                style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
              >
                {tj('bridgeCardTitle')}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-mute">
              {tj('bridgeCardHelper')}
            </p>
            <span className="inline-flex items-center gap-1.5 self-start rounded-pill border border-success bg-paper px-2.5 py-0.5 text-xs font-bold text-success-text">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-success"
              />
              {tj('bridgeLinkedCount', { count: bridgedCount })}
            </span>
          </div>

          {/* 2. CSV·Excel 업로드 — plaintext dropzone. */}
          <FileDropZone
            accept=".csv,.xlsx"
            maxSizeBytes={MAX_UPLOAD_BYTES}
            disabled={uploading || !inboxBatchId}
            onFiles={(files) => {
              if (files[0]) void uploadFile(files[0]);
            }}
            onError={() => notifyErr(t('fileTooLarge'))}
            label={uploading ? t('uploading') : t('uploadLabel')}
            helperText={t('uploadHelper')}
            className="px-6 py-8"
          />

          {/* 3. Google Sheets — R9 연동됨 카드(linked) vs url input(empty). */}
          <div className="flex flex-col gap-3 rounded-sm border-2 border-ink bg-paper px-5 py-4 shadow-memphis-sm">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-mint text-base"
                aria-hidden
              >
                📗
              </span>
              <p
                className="text-md font-extrabold text-ink"
                style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
              >
                {t('sheetsTitle')}
              </p>
            </div>

            {sheetLinked && !showSheetInput ? (
              <>
                {/* Linked card (R9 / 557): 시트명 + 마지막 동기화 + 재동기화/재연결. */}
                <div className="flex flex-col gap-0.5 rounded-xs border border-success-line bg-success-bg px-3 py-2">
                  <span className="truncate text-sm font-bold text-ink" title={project?.source_sheet_title ?? undefined}>
                    {project?.source_sheet_title || tj('sheetLinkedFallback')}
                  </span>
                  {project?.source_sheet_synced_at && (
                    <span className="font-mono text-xs text-mute-soft">
                      {tj('sheetSyncedAt', {
                        time: new Date(
                          project.source_sheet_synced_at,
                        ).toLocaleString(),
                      })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={resyncSheet}
                    disabled={importing}
                  >
                    {importing ? t('sheetsImporting') : tj('sheetResync')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={reconnectSheet}>
                    {tj('sheetReconnect')}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setShowSheetInput(true)}
                  >
                    {tj('sheetChange')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {!sheetLinked && (
                  <p className="text-sm leading-relaxed text-mute">
                    {t('sheetsHelper')}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={t('sheetsUrlLabel')}
                      placeholder={t('sheetsUrlPlaceholder')}
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void importSheet(sheetUrl);
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void importSheet(sheetUrl)}
                    disabled={importing || !sheetUrl.trim() || !inboxBatchId}
                  >
                    {importing ? t('sheetsImporting') : t('sheetsImport')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </div>

      {/* List controls (N2) — 전체/그룹별 · 상태 · 필드 필터 · 정렬. 슬롯 추가는
          탭③(일정) 소유 — 여기 없음. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y-2 border-line-soft py-3">
        <SegmentedControl
          ariaLabel={t('listModeLabel')}
          value={listMode}
          onChange={(v) => setListMode(v)}
          options={[
            { value: 'all', label: t('listModeAll') },
            { value: 'grouped', label: t('listModeGrouped') },
          ]}
        />
        <Select
          aria-label={t('statusFilterLabel')}
          size="sm"
          fullWidth={false}
          className="w-40 truncate"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as '' | CandidateStatus)
          }
          options={[
            { value: '', label: t('statusFilterAll') },
            { value: 'pending', label: t('candStatusPending') },
            { value: 'confirmed', label: t('candStatusConfirmed') },
            { value: 'communicating', label: t('candStatusCommunicating') },
          ]}
        />
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
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDir === 'asc' ? t('sortAsc') : t('sortDesc')}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk action bar — amber surface + amber hard shadow. R8: 그룹으로
          보내기 인라인 reveal(신규 제목 Input / 기존 그룹 Select). */}
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
            onClick={communicatingSelected}
            disabled={bulkBusy}
          >
            {t('bulkCommunicating')}
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
                disabled={bulkBusy || (!assignTitle.trim() && !assignBatchId)}
              >
                {t('bulkAssignGo')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Table — flat(전체) or By-group(그룹별, R1) sections + 미할당 inbox. */}
      {listMode === 'all' ? (
        renderTable(sortedCandidates)
      ) : (
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
                        <GroupRenameField
                          key={key}
                          batchId={key}
                          title={title}
                          onSaved={() => {
                            setRenamingKey(null);
                            void load();
                          }}
                        />
                      </div>
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate font-extrabold text-ink"
                        style={{
                          fontFamily: 'var(--font-outfit), var(--font-sans)',
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
    </div>
  );
}

// Inline group rename — the section head's Rename reveal. PATCHes the batch
// title; no-op on empty/unchanged. Keyed on the group id so a switch reseeds it.
function GroupRenameField({
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
      aria-label={t('groupRename')}
      placeholder={t('newGroupPlaceholder')}
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

// Memphis segmented control (BUILD-SPEC §1) — pill container w/ ink-fill active
// segment. Mirrors the recsched list control (the editorial <Tabs> primitive is
// a flat underline tab; CD wants the Memphis pill — AUTHORITY: don't downgrade).
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
          // eslint-disable-next-line react/forbid-elements -- CD Memphis segmented pill (ink-fill active seg); the Button primitive's per-button border/shadow/radius can't compose into one unified segmented control (recsched 리스트 컨트롤과 동일 선례)
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
