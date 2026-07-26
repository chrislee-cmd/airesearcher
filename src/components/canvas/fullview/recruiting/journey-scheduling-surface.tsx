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
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SchedulingCalendar,
  type CalendarView,
} from '@/components/admin/scheduling-calendar';
import {
  SlotEditorModal,
  type SlotDraft,
} from '@/components/admin/slot-editor-modal';
import { SchedulingChatPanel } from '@/components/admin/scheduling-chat-panel';
import { useSchedUnread } from '@/hooks/use-sched-unread';
import { BROADCAST_THREAD_ID } from '@/lib/scheduling/messages';
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
};

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

// Sticky-3col geometry preserved (CONTEXTRECSCHED A.2.5 / 보존 계약 44·168·184);
// the read-only roster drops the checkbox column so name pins to the left edge.
const STICKY_W = { name: 168, contact: 184 };
const DATA_CELL_MAX = 240;

function stickyStyle(left: number, w: number): CSSProperties {
  return { left, width: w, minWidth: w, maxWidth: w };
}

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
  // Surface a warning toast (chat-tile cap hit). Owned by the container's toast.
  notifyErr: (msg: string) => void;
}) {
  const t = useTranslations('RecruitingScheduling');

  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [calendarGroupId, setCalendarGroupId] = useState('');
  const [calendarFolded, setCalendarFolded] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [editorBatchId, setEditorBatchId] = useState('');

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

  // 개인 채팅 대상 = 확정된 전원(그룹 무관, spec 항목1).
  const confirmedChatCandidates = useMemo(
    () =>
      candidates
        .filter((c) => c.status === 'confirmed')
        .map((c) => ({ id: c.id, label: candidateLabel(c) })),
    // candidateLabel closes over t; candidates is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const calendarScopedCandidates = effectiveCalendarGroupId
    ? candidates.filter((c) => c.batch_id === effectiveCalendarGroupId)
    : candidates;
  // Confirmed attendees within the calendar's current scope — the roster below.
  const confirmedCandidates = calendarScopedCandidates.filter(
    (c) => c.status === 'confirmed',
  );
  // Confirmed roster as read-only group sections — the same 그룹뷰 shape as the
  // list view's by-group cards, scoped to the calendar's current group. Empty
  // groups are dropped; the 미할당 pool collects confirmed candidates not in any
  // named group (전체 mode only).
  const confirmedSections = [
    ...namedGroups
      .filter(
        (g) => !effectiveCalendarGroupId || g.id === effectiveCalendarGroupId,
      )
      .map((g) => ({
        key: g.id,
        title: g.title,
        rows: confirmedCandidates.filter((c) => c.batch_id === g.id),
      })),
    ...(effectiveCalendarGroupId
      ? []
      : [
          {
            key: '__ungrouped__',
            title: t('ungrouped'),
            rows: confirmedCandidates.filter(
              (c) => !namedGroupIds.has(c.batch_id),
            ),
          },
        ]),
  ].filter((s) => s.rows.length > 0);

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
      .map((c) => ({ id: c.id, label: candidateLabel(c) }));
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

  // Read-only confirmed-roster table (라운드3 그룹뷰) — full user columns, no
  // select/edit, a chat CTA per row (openTile → multi-window rail). Copied from
  // the admin renderTable's readOnly branch (sticky-3col geometry preserved).
  function renderRosterTable(rows: JourneyScheduleCandidate[]) {
    return (
      <div className="overflow-x-auto">
        {/* border-separate (not collapse): under border-collapse, z-index on
            sticky <td> is ignored in Chrome so scrolling columns bleed through
            the frozen ones. */}
        <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-sm">
          <thead className="[&_th]:border-b-2 [&_th]:border-ink [&_th]:bg-paper-soft [&_th]:font-mono [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-mute-soft">
            <tr className="text-left">
              <th
                className="sticky z-table-cell-sticky px-3.5 py-2.5"
                style={stickyStyle(0, STICKY_W.name)}
              >
                {t('colName')}
              </th>
              <th
                className="sticky z-table-cell-sticky border-r-2 border-ink px-3.5 py-2.5"
                style={stickyStyle(STICKY_W.name, STICKY_W.contact)}
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
              <th className="px-4 py-2.5">{t('confirmedChatCta')}</th>
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
                const contact = contactValue(c);
                return (
                  <tr key={c.id} className="group">
                    <td
                      className="sticky z-table-cell-sticky bg-paper px-3.5 py-2.5 text-ink transition-colors group-hover:bg-paper-soft"
                      style={stickyStyle(0, STICKY_W.name)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate font-bold"
                          title={c.name ?? undefined}
                        >
                          {c.name ?? '—'}
                        </span>
                        <span className="shrink-0 rounded-xs border border-success/30 bg-success-soft px-1.5 py-px text-xs font-extrabold text-success">
                          {t('confirmedChip')}
                        </span>
                      </div>
                    </td>
                    <td
                      className="sticky z-table-cell-sticky border-r-2 border-ink bg-paper px-3.5 py-2.5 font-mono text-md text-ink-2 transition-colors group-hover:bg-paper-soft"
                      style={stickyStyle(STICKY_W.name, STICKY_W.contact)}
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
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Button
                          variant="link"
                          size="xs"
                          onClick={() => openTile(c.id)}
                        >
                          {t('confirmedChatCta')}
                        </Button>
                        {isThreadUnread(c.id) && (
                          <UnreadDot label={t('chatUnreadBadge')} />
                        )}
                      </span>
                    </td>
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
                      // SMS 대상 수 힌트용 그룹 인원.
                      count: candidates.filter((c) => c.batch_id === g.id)
                        .length,
                    }))}
                    layout="sidebar"
                    selectedThread={thread}
                    // Multi-window: the panel's own reach/kind/개인 switcher
                    // re-targets THIS tile in place (single-window parity), not a
                    // new tile. New tiles come from roster rows + broadcast CTA.
                    onSelectThread={(id) => switchTile(tileId, id)}
                    onClose={() => closeTile(tileId)}
                    totalCount={candidates.length}
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

        {/* Confirmed roster — final-confirmed attendees within the calendar's
            current scope. Clicking a row opens that attendee's chat thread in a
            new tile; the header CTA opens the broadcast thread. */}
        <div className="flex flex-col gap-2 rounded-sm border-2 border-ink p-4 shadow-memphis-sm">
          <div className="flex items-center justify-between gap-2">
            {/* Roster disclosure toggle (수정1) — the whole heading bar is the
                fold control; the count stays visible when collapsed. */}
            {/* eslint-disable-next-line react/forbid-elements -- disclosure toggle (heading + boxed chevron); Button primitive chrome unsuitable for a bare list header (§7.11). 라이브 recsched 와 동일 선례. */}
            <button
              type="button"
              aria-expanded={rosterOpen}
              aria-label={t('confirmedToggleLabel')}
              onClick={() => setRosterOpen((v) => !v)}
              className="-mx-1.5 -my-1 flex min-w-0 flex-1 items-center gap-2 rounded-xs px-1.5 py-1 text-left transition-colors hover:bg-paper-soft"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 border-ink bg-paper text-xs text-ink shadow-memphis-2xs transition-transform ${rosterOpen ? '' : '-rotate-90'}`}
                aria-hidden
              >
                ▾
              </span>
              <span className="truncate text-sm font-bold text-ink">
                {t('confirmedHeading', { count: confirmedCandidates.length })}
              </span>
              <span className="shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-mute-soft">
                {rosterOpen ? t('rosterCollapseHint') : t('rosterExpandHint')}
              </span>
            </button>
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => openTile(BROADCAST_THREAD_ID)}
              >
                {t('confirmedBroadcastCta')}
              </Button>
              {isThreadUnread(BROADCAST_THREAD_ID) && (
                <UnreadDot label={t('chatUnreadBadge')} />
              )}
            </span>
          </div>
          {rosterOpen &&
            (confirmedCandidates.length === 0 ? (
              <p className="text-sm text-mute-soft">{t('confirmedEmpty')}</p>
            ) : (
              // Read-only 그룹뷰 (라운드3): a Memphis card per group, pastel head +
              // count pill (no Rename), holding the read-only table.
              <div className="flex flex-col gap-4">
                {confirmedSections.map(({ key, title, rows }, i) => {
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
                        <span
                          className="min-w-0 flex-1 truncate font-extrabold text-ink"
                          style={{
                            fontFamily: 'var(--font-outfit), var(--font-sans)',
                            fontSize: 16,
                          }}
                        >
                          {title}
                        </span>
                        <span className="shrink-0 rounded-pill border-[1.4px] border-ink bg-paper px-2.5 py-0.5 font-mono text-sm font-bold text-ink-2">
                          {rows.length}
                        </span>
                      </div>
                      {renderRosterTable(rows)}
                    </div>
                  );
                })}
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

// Next :00 or :30 from now, so the create form opens on a tidy boundary.
function roundToNextHalfHour(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(0, 0);
  const m = c.getMinutes();
  c.setMinutes(m < 30 ? 30 : 60);
  return c;
}

// Unread badge (빨간콩) — a Memphis-framed amore dot marking a thread with an
// unseen participant message.
function UnreadDot({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-ink bg-amore shadow-memphis-2xs"
    />
  );
}

// Next-slot dot color by status — binds the recsched slot-status tokens.
function slotDotClass(status: SlotStatus): string {
  return status === 'confirmed'
    ? 'bg-slot-confirmed-dot'
    : status === 'cancelled'
      ? 'bg-slot-cancelled-dot'
      : 'bg-slot-proposed-dot';
}
