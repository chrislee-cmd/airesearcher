'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneySchedulingSurface — recruiting 저니 셸 탭③ 일정의 실제 본문.

   re-home (규칙 2e "정답이 이미 있으면 복사"): 라이브
   `admin/recruiting-scheduling-client.tsx` 의 calendar+chat+roster+editor
   표면(그 파일의 tab==='calendar' 브랜치)을 그대로 옮겨온다. 자식
   컴포넌트(SchedulingCalendar · SchedulingChatPanel · SlotEditorModal)와
   보존 계약(채팅 fan-out · 슬롯 fan-out · Realtime/폴링 · unread last-seen)은
   손대지 않고 재사용 — 이 컨테이너는 오케스트레이션(멀티타일·로스터
   그룹뷰·슬롯에디터 배선)만 소유한다.

   라이브와의 유일한 차이: 라이브는 서버 컴포넌트가 데이터를 공급해
   mutation 뒤 `router.refresh()` 로 재조회했지만, 저니 풀뷰는 데이터를
   클라이언트에서 `/api/scheduling/journey/schedule` 로 페치하므로
   `onRefetch()` 콜백으로 재조회한다. 프레임/사이드바/헤더(프로젝트 pill·
   Share·CSV·refresh·3탭)는 저니 셸이 소유 — 여기선 캘린더 카드부터.
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  SchedulingCalendar,
  type CalendarView,
} from '@/components/admin/scheduling-calendar';
import {
  SlotEditorModal,
  type SlotDraft,
} from '@/components/admin/slot-editor-modal';
import { SchedulingChatPanel } from '@/components/admin/scheduling-chat-panel';
import { UnreadBadge } from '@/components/ui/unread-badge';
import { useSchedUnread } from '@/hooks/use-sched-unread';
import { BROADCAST_THREAD_ID } from '@/lib/scheduling/messages';
import { CONTACT_MASK } from '@/lib/scheduling/candidate-masking';
import { relativeJoined } from '@/lib/relative-time';
import {
  type SchedSlot,
  type SlotStatus,
  nextSlotForCandidate,
  toLocalInputValue,
} from '@/lib/scheduling/slots';

// Candidate shape the schedule surface needs (subset of the admin
// SchedCandidate — no participant_token, since the master link is one
// project-shared token now). `source` drives nothing here (contact masking is
// already server-enforced), kept optional for the fetch shape.
export type JourneyScheduleCandidate = {
  id: string;
  batch_id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
  status: string;
  source?: string | null;
  // 합류 확인 시각(폰게이트 최초 통과). null = 미합류 → 문자 알림 자격 없음.
  // 서버가 문자 발송의 최종 게이트라 이 값은 컴포저의 대상 수(M명) 힌트 산출용.
  joined_at?: string | null;
};

// 문자 알림 자격 = 합류 확인(joined_at) ∩ 전화 보유. 컴포저의 대상 수(M명) 힌트에만
// 쓰인다 — 실제 발송 게이트는 서버(sms-notify.ts). masking 뷰어는 전화가 '●●●●' 로
// 채워져 있어 과대 계상될 수 있으나 서버가 최종 필터하므로 힌트로 충분.
function smsEligibleOf(c: JourneyScheduleCandidate): boolean {
  return !!c.phone && !!c.joined_at;
}

export type JourneyScheduleGroup = {
  id: string;
  title: string;
  created_at: string;
  is_inbox?: boolean | null;
};

export type JourneyScheduleProject = {
  id: string;
  title: string;
  share_token?: string | null;
};

// Sticky-3col geometry preserved (CONTEXTRECSCHED A.2.5 / 보존 계약 44·168·184).
// The roster is now a managed list (전체/확정 토글 + 벌크 액션) so it carries the
// checkbox column exactly like the 명단 tab — check 44 / name 168 / contact 184.
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

// Roster scope toggle — 전체(all, 미확정 포함 = 구 명단) vs 확정(구 로스터).
// Default = 전체: this tab is now the coordination surface so the candidate pool
// shows first (spec §1).
type RosterScope = 'all' | 'confirmed';

// Chat rail — up to 4 tiled thread panels (수정4); the 5th open is blocked with a
// hint toast (no eviction — conservative per spec).
const MAX_CHAT_PANELS = 4;

// Pastel tints cycled across confirmed-roster group heads (BUILD-SPEC §1); the
// inbox (미할당) head stays neutral (paper-soft) separately.
const HEAD_TINTS = ['bg-sky', 'bg-mint', 'bg-lav', 'bg-peach', 'bg-cyan'] as const;

export function JourneySchedulingSurface({
  project,
  groups,
  candidates,
  slots,
  formId,
  onRefetch,
  notifyErr,
  notifyOk,
}: {
  project: JourneyScheduleProject;
  groups: JourneyScheduleGroup[];
  candidates: JourneyScheduleCandidate[];
  slots: SchedSlot[];
  // The form this journey surface is anchored on — forwarded to the slot editor
  // so an anchorless standalone slot resolves to the project's inbox batch on the
  // server (card #572). Always set in the journey shell (tab renders only with a
  // form).
  formId: string | null;
  // Re-fetch the journey/schedule bundle after a mutation (slot save/delete,
  // group rename) — the client-side analog of the admin surface's
  // router.refresh().
  onRefetch: () => void;
  // Surface a warning toast (chat-tile cap hit, bulk-action failure). Owned by the
  // container's toast.
  notifyErr: (msg: string) => void;
  // Surface a success toast (bulk confirm/communicate/assign). Owned by the
  // container's toast.
  notifyOk: (msg: string) => void;
}) {
  const t = useTranslations('RecruitingScheduling');
  const tj = useTranslations('Recruiting.journey');

  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [calendarGroupId, setCalendarGroupId] = useState('');
  const [calendarFolded, setCalendarFolded] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [editorBatchId, setEditorBatchId] = useState('');

  // --- Roster scope + candidate-pool management (탭② 에서 이식) ----------
  const [rosterScope, setRosterScope] = useState<RosterScope>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignBatchId, setAssignBatchId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  // "upcoming vs past" boundary for the roster's 다음 슬롯 column. Reading
  // Date.now() in render trips react-hooks/purity; a lazy initializer is the
  // codebase's convention.
  const [now] = useState(() => Date.now());

  // Chat multi-tile (수정4). Tiles keyed by a STABLE tileId (not thread) so a
  // tile can freely switch threads without a React key collision. Broadcast
  // opens by default (single-window parity — never empty on first paint).
  const tileSeqRef = useRef(1);
  const [chatTiles, setChatTiles] = useState<
    { tileId: string; thread: string }[]
  >([{ tileId: 't0', thread: BROADCAST_THREAD_ID }]);

  // Unread badge (빨간콩) — participant messages unseen by the admin, per thread.
  // batchIds = every group so private threads across the project are covered.
  const unreadBatchIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const unread = useSchedUnread(project.id, unreadBatchIds);
  const { markSeen: markThreadSeen, isUnread: isThreadUnread } = unread;
  const unreadLatest = unread.latestParticipantAt;
  useEffect(() => {
    for (const { thread } of chatTiles) {
      const at = unreadLatest.get(thread);
      if (at && isThreadUnread(thread)) markThreadSeen(thread);
    }
  }, [chatTiles, unreadLatest, isThreadUnread, markThreadSeen]);

  // Groups the user can pick = assignment groups only; the inbox pool stays
  // behind the "전체" option.
  const namedGroups = groups.filter((g) => !g.is_inbox);
  const namedGroupIds = new Set(namedGroups.map((g) => g.id));

  // Calendar filter, validated against existing named groups; '' = 전체.
  const effectiveCalendarGroupId = namedGroups.some(
    (g) => g.id === calendarGroupId,
  )
    ? calendarGroupId
    : '';
  // A concrete batch id the calendar hands to batch-scoped children (chat,
  // title, slot create). Falls back to the first batch when spanning all groups.
  const activeCalendarGroupId = effectiveCalendarGroupId || (groups[0]?.id ?? '');

  const fieldColumns = useMemo(
    () =>
      Array.from(
        new Set(candidates.flatMap((c) => Object.keys(c.fields))),
      ).sort(),
    [candidates],
  );

  function candidateLabel(c: JourneyScheduleCandidate): string {
    return c.name || c.email || c.phone || t('unnamedCandidate');
  }

  // Contact column: phone first, email fallback (spec §2).
  function contactValue(c: JourneyScheduleCandidate): string | null {
    return c.phone || c.email || null;
  }

  const candidateNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) map.set(c.id, candidateLabel(c));
    return map;
    // candidateLabel closes over t; candidates is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  // 개인 채팅 대상 = 확정된 전원(그룹 무관, spec 항목1). smsEligible = 합류∩전화 —
  // 개인 reach 에서 문자 자격 여부(체크박스 비활성/사유)를 판정한다.
  const confirmedChatCandidates = useMemo(
    () =>
      candidates
        .filter((c) => c.status === 'confirmed')
        .map((c) => ({
          id: c.id,
          label: candidateLabel(c),
          smsEligible: smsEligibleOf(c),
        })),
    // candidateLabel closes over t; candidates is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates],
  );

  // 문자 알림 대상 수(힌트) — 전체 reach(= 확정자) 기준. N = 확정자, M = 확정자 중
  // 합류∩전화. 서버가 최종 게이트라 어디까지나 근사(masking 뷰어는 전화 미상).
  const confirmedCount = useMemo(
    () => candidates.filter((c) => c.status === 'confirmed').length,
    [candidates],
  );
  const confirmedSmsCount = useMemo(
    () =>
      candidates.filter((c) => c.status === 'confirmed' && smsEligibleOf(c))
        .length,
    [candidates],
  );

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

  // --- Chat panel orchestration (수정4) ---

  // Open a thread in a NEW tile — driven by roster rows + the broadcast CTA. If a
  // tile already shows it → focus (no dup). At the cap → block the 5th with a
  // hint toast; no eviction (conservative per spec).
  function openTile(thread: string) {
    if (chatTiles.some((c) => c.thread === thread)) return;
    if (chatTiles.length >= MAX_CHAT_PANELS) {
      notifyErr(t('chatMaxPanels'));
      return;
    }
    markThreadSeen(thread);
    const tileId = `t${tileSeqRef.current++}`;
    setChatTiles((prev) =>
      prev.some((c) => c.thread === thread) || prev.length >= MAX_CHAT_PANELS
        ? prev
        : [...prev, { tileId, thread }],
    );
  }

  // Re-target ONE tile's thread in place — driven by a panel's own reach/kind/개인
  // switcher (single-window parity). Unconditional: tiles are keyed by tileId, so
  // duplicate threads are harmless (a personal tile can switch to broadcast even
  // if one's open).
  function switchTile(tileId: string, thread: string) {
    markThreadSeen(thread);
    setChatTiles((prev) =>
      prev.map((c) => (c.tileId === tileId ? { ...c, thread } : c)),
    );
  }

  function closeTile(tileId: string) {
    setChatTiles((prev) => prev.filter((c) => c.tileId !== tileId));
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
    onRefetch();
  }

  // --- Calendar scoping ---
  // The calendar spans every group by default ('' = 전체); the nested filter
  // narrows it to one group.
  const calendarSlots = effectiveCalendarGroupId
    ? slots.filter((s) => s.batch_id === effectiveCalendarGroupId)
    : slots;
  // --- Roster (전체/확정 토글 단일 리스트) --------------------------------
  // 전체 = 미확정 포함(구 명단) · 확정 = confirmed only(구 로스터). Default 전체.
  const rosterRows = useMemo(
    () =>
      rosterScope === 'confirmed'
        ? candidates.filter((c) => c.status === 'confirmed')
        : candidates,
    [candidates, rosterScope],
  );

  // The roster shows the WHOLE project (no calendar-scope filter — you must see
  // other groups to reassign into them, spec §1). When the calendar is narrowed
  // to a group, float that group's section to the top rather than hiding the rest.
  const orderedNamedGroups = useMemo(
    () =>
      effectiveCalendarGroupId
        ? [...namedGroups].sort((a, b) =>
            a.id === effectiveCalendarGroupId
              ? -1
              : b.id === effectiveCalendarGroupId
                ? 1
                : 0,
          )
        : namedGroups,
    // namedGroups is derived fresh each render; effectiveCalendarGroupId is the
    // real ordering input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveCalendarGroupId, candidates, groups, calendarGroupId],
  );

  // Group sections (그룹뷰): every named group (kept even when empty so assign/
  // rename targets stay visible, 명단 tab parity) + a 미할당 inbox pool (only when
  // it has rows). The inbox stays last regardless of calendar scope.
  const ungroupedRoster = rosterRows.filter(
    (c) => !namedGroupIds.has(c.batch_id),
  );
  const rosterSections: {
    key: string;
    title: string;
    rows: JourneyScheduleCandidate[];
    isInbox: boolean;
  }[] = [
    ...orderedNamedGroups.map((g) => ({
      key: g.id,
      title: g.title,
      rows: rosterRows.filter((c) => c.batch_id === g.id),
      isInbox: false,
    })),
    ...(ungroupedRoster.length
      ? [
          {
            key: '__ungrouped__',
            title: t('ungrouped'),
            rows: ungroupedRoster,
            isInbox: true,
          },
        ]
      : []),
  ];

  // --- Selection + bulk actions (탭② 그대로 이식, refetch + 토스트) --------
  function rowsAllSelected(rows: JourneyScheduleCandidate[]): boolean {
    return rows.length > 0 && rows.every((c) => selected.has(c.id));
  }
  function toggleRows(rows: JourneyScheduleCandidate[]) {
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
      onRefetch();
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
      onRefetch();
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
          ...(project.id ? { projectId: project.id } : {}),
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
      onRefetch();
    } finally {
      setBulkBusy(false);
    }
  }

  const assignBatchOptions = [
    { value: '', label: t('bulkChooseGroup') },
    ...namedGroups.map((g) => ({ value: g.id, label: g.title })),
  ];

  // Source provenance chip (소스 컬럼) — bridge=🧲 green, upload=📄, sheet=📗.
  // null (legacy) reads as plaintext → upload style. Copied from the 명단 tab.
  function sourceMeta(source: string | null | undefined): {
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

  // Status chip (상태 컬럼) — reuses the existing 확정/소통중 표기 tokens (no new
  // treatment invented, spec §1); pending is a neutral chip.
  function statusChip(status: string): { label: string; cls: string } {
    if (status === 'confirmed') {
      return {
        label: t('candStatusConfirmed'),
        cls: 'border-success/30 bg-success-soft text-success',
      };
    }
    if (status === 'communicating') {
      return {
        label: t('candStatusCommunicating'),
        cls: 'border-amore/30 bg-amore-bg text-amore',
      };
    }
    return {
      label: t('candStatusPending'),
      cls: 'border-line bg-paper-soft text-mute',
    };
  }

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

  // Chat is inherently per-group. A per-candidate thread resolves to that
  // candidate's own group; broadcast (and the fallback) uses the calendar's
  // resolved batch. Each open panel resolves its OWN batch + roster so the send
  // scope (fan-out payload) stays coherent per thread (수정4 multi-window).
  function resolveChatContext(threadId: string): {
    batchId: string;
    candidateOptions: { id: string; label: string }[];
  } {
    const cand =
      threadId && threadId !== BROADCAST_THREAD_ID
        ? (candidates.find((c) => c.id === threadId) ?? null)
        : null;
    const batchId = cand?.batch_id ?? activeCalendarGroupId;
    const candidateOptions = candidates
      .filter((c) => c.batch_id === batchId)
      .map((c) => ({
        id: c.id,
        label: candidateLabel(c),
        smsEligible: smsEligibleOf(c),
      }));
    return { batchId, candidateOptions };
  }

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

  // Managed roster table (전체/확정 토글 단일 리스트) — check·이름·연락처·소스·
  // 이메일·상태·다음 슬롯·동적 fields (spec §1 컬럼셋). Sticky-3col preserved
  // (check 44 / name 168 / contact 184); source is the first scrollable column.
  // Contact/email arrive server-masked (●●●● + 🔒) — the client renders them as-is
  // (클라 마스킹 금지). 확정자는 상태 칩으로 구분(기존 표기 재사용).
  function renderRosterTable(rows: JourneyScheduleCandidate[]) {
    // check + name + contact + linkAccess + source + email + status + slot + N fields.
    const colSpan = 8 + fieldColumns.length;
    return (
      <div className="overflow-x-auto">
        {/* border-separate (not collapse): under border-collapse, z-index on
            sticky <td> is ignored in Chrome so scrolling columns bleed through
            the frozen ones. */}
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
              <th className="px-4 py-2.5">{t('colLinkAccess')}</th>
              <th className="px-4 py-2.5">{tj('colSource')}</th>
              <th className="px-4 py-2.5">{t('colEmail')}</th>
              <th className="px-4 py-2.5">{t('statusColLabel')}</th>
              <th className="px-4 py-2.5">{t('colSlot')}</th>
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
                  colSpan={colSpan}
                >
                  {t('emptyCandidates')}
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const next = nextSlotForCandidate(c.id, slots, now);
                const contact = contactValue(c);
                const contactMasked = contact === CONTACT_MASK;
                const emailMasked = c.email === CONTACT_MASK;
                const src = sourceMeta(c.source);
                const chip = statusChip(c.status);
                const checked = selected.has(c.id);
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
                      className={`sticky z-table-cell-sticky border-r-2 border-ink bg-paper px-3.5 py-2.5 font-mono text-md transition-colors group-hover:bg-paper-soft ${
                        contactMasked ? 'text-faint' : 'text-ink-2'
                      }`}
                      style={stickyStyle(STICKY_LEFT.contact, STICKY_W.contact)}
                    >
                      <div
                        className="truncate"
                        title={contactMasked ? undefined : (contact ?? undefined)}
                      >
                        {contactMasked ? `🔒 ${contact}` : (contact ?? '—')}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.joined_at ? (
                        // 폰게이트(6자리) 통과 = 접속함. 상대시간은 공용 relativeJoined.
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-success">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full bg-success"
                            aria-hidden
                          />
                          {t('linkAccessJoined')}
                          <span className="font-mono text-xs font-normal tabular-nums text-mute-soft">
                            · {relativeJoined(c.joined_at, now, t)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-faint">
                          {t('linkAccessNone')}
                        </span>
                      )}
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
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-xs border px-1.5 py-px text-xs font-extrabold ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {next ? (
                        <span className="flex items-center gap-1.5 text-sm">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${slotDotClass(next.status)}`}
                          />
                          <span className="font-bold text-ink">
                            {slotTimeFmt.format(new Date(next.start_at))}
                          </span>
                          <span className="text-mute-soft">
                            · {statusLabel[next.status]}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-mute-soft">
                          {t('confirmedNoSlot')}
                        </span>
                      )}
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    // 탭③ 내부 스크롤 소유 (D2 — 카드 intrinsic ~1020px, 1600×940 프레임 안).
    <div className="min-h-0 flex-1 overflow-y-auto p-[26px]">
      <div className="flex flex-col gap-4">
        {effectiveCalendarGroupId && (
          <div className="max-w-md">
            <BatchTitleField
              key={effectiveCalendarGroupId}
              batchId={effectiveCalendarGroupId}
              title={currentGroup?.title ?? ''}
              onSaved={onRefetch}
            />
          </div>
        )}

        {/* Two-pane card (수정2, h 1020) — colored-block calendar (left) +
            multi-tile chat rail (right). */}
        <div className="flex flex-col overflow-hidden rounded-sm border-2 border-ink shadow-memphis-md lg:h-[1020px] lg:flex-row">
          {/* Calendar pane — collapsible horizontally on desktop (수정3). Always
              shown on mobile (panes stack there). */}
          {!calendarFolded && (
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
          )}

          {/* Fold rail (수정3) — desktop handle collapsing/expanding the calendar
              pane. Hidden on mobile (panes already stack). */}
          {/* eslint-disable-next-line react/forbid-elements -- full-height vertical fold handle; Button primitive chrome unsuitable for a rail toggle (§7.11). 라이브 recsched 와 동일 선례. */}
          <button
            type="button"
            onClick={() => setCalendarFolded((v) => !v)}
            aria-label={calendarFolded ? t('calendarExpand') : t('calendarFold')}
            className="hidden shrink-0 flex-col items-center justify-center gap-3 bg-paper-soft transition-colors hover:bg-paper lg:flex lg:w-9 lg:border-l-2 lg:border-ink"
          >
            <span className="text-lg font-bold text-ink" aria-hidden>
              {calendarFolded ? '›' : '‹'}
            </span>
            {calendarFolded && (
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-mute-soft [writing-mode:vertical-rl]">
                {t('calendarExpand')}
              </span>
            )}
          </button>

          {/* Chat pane — up to 4 tiled thread panels (수정4). Expanded: caps its
              width + scrolls horizontally so the calendar keeps room; folded: it
              fills the freed width. Each panel resolves its own batch/roster and
              closes independently. 타일폭 380px (comp 승, GAP-AUDIT §3). */}
          <div
            className={[
              'flex w-full flex-col overflow-x-auto border-t-2 border-ink lg:min-h-0 lg:flex-row lg:border-t-0',
              calendarFolded
                ? 'lg:min-w-0 lg:flex-1'
                : 'lg:w-auto lg:max-w-[800px] lg:shrink-0',
            ].join(' ')}
          >
            {chatTiles.map(({ tileId, thread }, i) => {
              const ctx = resolveChatContext(thread);
              if (!ctx.batchId) return null;
              return (
                <aside
                  key={tileId}
                  className={[
                    'flex min-h-[540px] w-full flex-col lg:min-h-0 lg:w-[380px] lg:shrink-0',
                    i > 0
                      ? 'border-t-2 border-ink lg:border-l-2 lg:border-t-0'
                      : '',
                  ].join(' ')}
                >
                  <SchedulingChatPanel
                    batchId={ctx.batchId}
                    candidates={ctx.candidateOptions}
                    // 개인 피커는 확정 전원(그룹 무관) — spec 항목1.
                    personalCandidates={confirmedChatCandidates}
                    groups={namedGroups.map((g) => ({
                      id: g.id,
                      title: g.title,
                      // 그룹 공지 수신자 집합 = 그룹 내 확정자(N). smsCount = 그중
                      // 합류∩전화(M). 서버 발송 게이트와 같은 기준.
                      count: candidates.filter(
                        (c) => c.batch_id === g.id && c.status === 'confirmed',
                      ).length,
                      smsCount: candidates.filter(
                        (c) =>
                          c.batch_id === g.id &&
                          c.status === 'confirmed' &&
                          smsEligibleOf(c),
                      ).length,
                    }))}
                    layout="sidebar"
                    selectedThread={thread}
                    // Multi-window: the panel's own reach/kind/개인 switcher
                    // re-targets THIS tile in place (single-window parity), not a
                    // new tile. New tiles come from roster rows + broadcast CTA.
                    onSelectThread={(id) => switchTile(tileId, id)}
                    onClose={() => closeTile(tileId)}
                    // 개인 피커 안읽음 배지 — 후보(threadId=candidate.id)별 미확인
                    // 참석자 메시지 수. 열린 스레드는 markSeen 유지(위 effect)라 0.
                    unreadCount={unread.unreadCount}
                    // 전체 공지 수신자 집합 = 확정자(N), 문자 자격 = 확정∩합류∩전화(M).
                    confirmedCount={confirmedCount}
                    confirmedSmsCount={confirmedSmsCount}
                    // 일정 패널 소스 — the full slot set so the panel's own scope
                    // filter (전체/그룹/개인) resolves any target. Click → openEdit.
                    slots={slots}
                    onEditSlot={openEdit}
                  />
                </aside>
              );
            })}
          </div>
        </div>

        {/* Roster — 전체/확정 토글 단일 리스트 (후보 풀 관리 흡수). Shows the WHOLE
            project as 그룹뷰 sections (pastel head + count + rename) + 미할당 inbox;
            the calendar's current group floats to the top. The header CTA opens the
            broadcast chat thread; row selection drives the bulk action bar. */}
        <div className="flex flex-col gap-2 rounded-sm border-2 border-ink p-4 shadow-memphis-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* Roster disclosure toggle (수정1) — chevron + heading fold the
                  list; the count stays visible when collapsed. */}
              {/* eslint-disable-next-line react/forbid-elements -- disclosure toggle (heading + boxed chevron); Button primitive chrome unsuitable for a bare list header (§7.11). 라이브 recsched 와 동일 선례. */}
              <button
                type="button"
                aria-expanded={rosterOpen}
                aria-label={t('confirmedToggleLabel')}
                onClick={() => setRosterOpen((v) => !v)}
                className="-mx-1.5 -my-1 flex min-w-0 items-center gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-paper-soft"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-paper text-xs text-ink shadow-memphis-2xs transition-transform ${rosterOpen ? '' : '-rotate-90'}`}
                  aria-hidden
                >
                  ▾
                </span>
                <span className="truncate text-sm font-bold text-ink">
                  {t('rosterHeading')} ({rosterRows.length})
                </span>
                <span className="shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-mute-soft">
                  {rosterOpen ? t('rosterCollapseHint') : t('rosterExpandHint')}
                </span>
              </button>
              {/* 전체/확정 scope toggle — default 전체 (spec §1). Switching scope
                  clears any selection so a bulk action never targets hidden rows. */}
              <RosterScopeToggle
                ariaLabel={t('rosterScopeLabel')}
                value={rosterScope}
                onChange={(v) => {
                  setRosterScope(v);
                  clearSelection();
                }}
                options={[
                  { value: 'all', label: t('rosterScopeAll') },
                  { value: 'confirmed', label: t('rosterScopeConfirmed') },
                ]}
              />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => openTile(BROADCAST_THREAD_ID)}
              >
                {t('confirmedBroadcastCta')}
              </Button>
              {isThreadUnread(BROADCAST_THREAD_ID) && (
                <UnreadBadge label={t('chatUnreadBadge')} />
              )}
            </span>
          </div>

          {/* Bulk action bar (탭② parity) — amber surface + amber hard shadow.
              그룹으로 보내기 인라인 reveal(신규 제목 Input / 기존 그룹 Select). */}
          {rosterOpen && selected.size > 0 && (
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

          {rosterOpen &&
            (rosterSections.length === 0 ? (
              <p className="text-sm text-mute-soft">{t('confirmedEmpty')}</p>
            ) : (
              // 그룹뷰: a Memphis card per group (pastel head + count pill + Rename)
              // holding the managed table. 미할당 inbox stays neutral, no rename.
              <div className="flex flex-col gap-4">
                {rosterSections.map(({ key, title, rows, isInbox }, i) => (
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
                              onRefetch();
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
                    {renderRosterTable(rows)}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>

      <SlotEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        draft={draft}
        candidates={editorCandidateOptions}
        batchId={editorBatchId}
        formId={formId}
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

// Inline group rename — the section head's Rename reveal (탭② 에서 그대로 이식).
// PATCHes the batch title; no-op on empty/unchanged. Keyed on the group id so a
// switch reseeds it.
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

// Memphis segmented control (BUILD-SPEC §1) — the 전체/확정 roster scope toggle.
// Mirrors the 명단 tab's list-control pill (ink-fill active segment); the editorial
// <Tabs> primitive is a flat underline tab, CD wants the Memphis pill.
function RosterScopeToggle<T extends string>({
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
          // eslint-disable-next-line react/forbid-elements -- CD Memphis segmented pill (ink-fill active seg); the Button primitive's per-button border/shadow/radius can't compose into one unified segmented control (명단 리스트 컨트롤과 동일 선례)
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

// Next :00 or :30 from now, so the create form opens on a tidy boundary.
function roundToNextHalfHour(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(0, 0);
  const m = c.getMinutes();
  c.setMinutes(m < 30 ? 30 : 60);
  return c;
}

// Next-slot dot color by status — binds the recsched slot-status tokens.
function slotDotClass(status: SlotStatus): string {
  return status === 'confirmed'
    ? 'bg-slot-confirmed-dot'
    : status === 'cancelled'
      ? 'bg-slot-cancelled-dot'
      : 'bg-slot-proposed-dot';
}
