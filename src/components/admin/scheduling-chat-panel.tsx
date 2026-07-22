'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSchedMessages } from '@/hooks/use-sched-messages';
import {
  BROADCAST_THREAD_ID,
  groupMessages,
  MAX_MESSAGE_LENGTH,
  type MessageScope,
  type SchedMessage,
} from '@/lib/scheduling/messages';
import {
  slotsForScope,
  type SchedSlot,
  type SlotStatus,
} from '@/lib/scheduling/slots';

export type ChatCandidate = { id: string; label: string };
export type ChatGroup = { id: string; title: string };

// The top-level kind toggle: 공지글(announcement banner) vs 채팅 메세지(chat bubble).
type AnnounceMode = 'announcement' | 'chat';
// The reach axis under each kind. 공지글 = [전체 | 그룹]; 채팅 = [전체 | 그룹 | 개인].
type ReachScope = 'all' | 'group' | 'personal';

type Props = {
  batchId: string;
  candidates: ChatCandidate[];
  // The project's named groups (assignment groups, not the inbox pool), for the
  // 그룹 reach picker. Omitted / empty → only 전체 (and 개인) reach.
  groups?: ChatGroup[];
  // Controlled thread selection (unified view). When provided, the parent owns
  // which thread is open — clicking a confirmed candidate elsewhere in the page
  // drives this and, via the hierarchy sync, flips the composer to 채팅→개인.
  selectedThread?: string;
  onSelectThread?: (threadId: string) => void;
  // 'panel' = classic two-pane (thread list + messages). 'sidebar' = single
  // column (hierarchy → 일정 패널 → messages + composer) in the calendar rail.
  layout?: 'panel' | 'sidebar';
  onClose?: () => void;
  // Assigned-schedule panel source (sidebar only): the client's slots. Filtered
  // by the current compose scope (전체=all · 그룹=batch · 개인=candidate).
  slots?: SchedSlot[];
  // Slot click → open the slot editor modal (parent's `openEdit`).
  onEditSlot?: (slot: SchedSlot) => void;
};

// Admin chat panel: a broadcast announcement/chat channel + one private thread
// per candidate, now organized as a hierarchy — 공지글/채팅 메세지 kind toggle →
// 전체/그룹/개인 reach → target picker — mapped onto the same send API (510).
// Messages are loaded + kept live by useSchedMessages (realtime + poll).
export function SchedulingChatPanel({
  batchId,
  candidates,
  groups = [],
  selectedThread: controlledThread,
  onSelectThread,
  layout = 'panel',
  onClose,
  slots,
  onEditSlot,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const { messages, loading, refetch } = useSchedMessages(batchId);

  const [internalThread, setInternalThread] =
    useState<string>(BROADCAST_THREAD_ID);
  const isControlled = controlledThread !== undefined;
  const selectedThread = isControlled ? controlledThread : internalThread;
  const selectThread = (id: string) => {
    if (onSelectThread) onSelectThread(id);
    if (!isControlled) setInternalThread(id);
  };

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compose hierarchy state:
  //   announceMode  — 공지글(announcement, banner) vs 채팅 메세지(chat, bubble)
  //   broadcastReach — 전체(all) vs 그룹(one group), for broadcast sends only
  //   groupTarget   — the batch id when broadcastReach==='group'
  // 개인 is NOT stored here — it is DERIVED from the open thread (selectedThread
  // being a candidate id). So a candidate clicked elsewhere in the page and a
  // 개인 pick in this selector converge on one source of truth (selectedThread),
  // with no effect-based state sync (which react-hooks/set-state-in-effect bans).
  const [announceMode, setAnnounceMode] = useState<AnnounceMode>('announcement');
  const [broadcastReach, setBroadcastReach] = useState<'all' | 'group'>('all');
  const [groupTarget, setGroupTarget] = useState<string>(() =>
    groups.some((g) => g.id === batchId) ? batchId : (groups[0]?.id ?? ''),
  );

  const { broadcast, byCandidate } = useMemo(
    () => groupMessages(messages),
    [messages],
  );

  const candidateLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) map.set(c.id, c.label);
    return map;
  }, [candidates]);

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
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

  const isBroadcast = selectedThread === BROADCAST_THREAD_ID;
  const isPersonal = !isBroadcast;
  // Effective hierarchy shown/sent. A candidate thread always resolves to
  // 채팅→개인; otherwise the stored broadcast kind/reach apply.
  const kind: AnnounceMode = isPersonal ? 'chat' : announceMode;
  const reachScope: ReachScope = isPersonal ? 'personal' : broadcastReach;
  const threadMessages: SchedMessage[] = isBroadcast
    ? broadcast
    : (byCandidate.get(selectedThread) ?? []);

  // Assigned-schedule slots for the current compose scope (sidebar only).
  const scopedSlots = useMemo(() => {
    if (!slots) return [];
    if (reachScope === 'group')
      return groupTarget
        ? slotsForScope(slots, { kind: 'group', batchId: groupTarget })
        : [];
    if (reachScope === 'personal')
      return isBroadcast
        ? []
        : slotsForScope(slots, {
            kind: 'personal',
            candidateId: selectedThread,
          });
    return slotsForScope(slots, { kind: 'all' });
  }, [slots, reachScope, groupTarget, isBroadcast, selectedThread]);

  // Auto-scroll the message list to the newest message on thread change / new
  // message arrival.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadMessages.length, selectedThread]);

  // Group reach needs a concrete target; 개인 needs a concrete candidate.
  const sendReady =
    reachScope === 'all' ||
    (reachScope === 'group' && !!groupTarget) ||
    (reachScope === 'personal' && !isBroadcast);

  // --- Hierarchy handlers (keep announceMode/reachScope/selectedThread coherent) ---

  function pickKind(mode: AnnounceMode) {
    setAnnounceMode(mode);
    // 개인 lives only under 채팅. Going to 공지글 while on 개인 drops to 전체 broadcast.
    if (mode === 'announcement' && isPersonal) {
      setBroadcastReach('all');
      selectThread(BROADCAST_THREAD_ID);
    }
  }

  function pickReach(scope: ReachScope) {
    if (scope === 'personal') {
      setAnnounceMode('chat');
      // Land on a concrete candidate so the private thread + send have a target.
      if (isBroadcast && candidates[0]) selectThread(candidates[0].id);
      return;
    }
    setBroadcastReach(scope);
    selectThread(BROADCAST_THREAD_ID);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    if (!sendReady) return;
    setSending(true);
    setError(null);
    const scope: MessageScope = isPersonal ? 'private' : 'broadcast';
    try {
      const res = await fetch('/api/scheduling/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          body: text,
          ...(isPersonal
            ? { candidate_id: selectedThread }
            : {
                is_announcement: kind === 'announcement',
                ...(reachScope === 'group' && groupTarget
                  ? { batch_id: groupTarget }
                  : {}),
              }),
        }),
      });
      if (!res.ok) {
        setError(t('chatSendFailed'));
        return;
      }
      setDraft('');
      // Optimistic-ish: realtime will also fire, but refetch guarantees the
      // sender sees their message immediately even if the WebSocket lags.
      await refetch();
    } catch {
      setError(t('chatSendFailed'));
    } finally {
      setSending(false);
    }
  }

  const threadTitle = isBroadcast
    ? t('chatBroadcast')
    : (candidateLabelById.get(selectedThread) ?? t('unnamedCandidate'));

  // --- Compose hierarchy: kind toggle → reach → target picker ---
  const hierarchy = (
    <div className="flex flex-col gap-2 border-b border-line-soft px-4 py-3">
      {/* Top level: 공지글 | 채팅 메세지 */}
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant={kind === 'announcement' ? 'secondary' : 'ghost'}
          onClick={() => pickKind('announcement')}
        >
          {t('chatKindAnnouncement')}
        </Button>
        <Button
          size="xs"
          variant={kind === 'chat' ? 'secondary' : 'ghost'}
          onClick={() => pickKind('chat')}
        >
          {t('chatKindChat')}
        </Button>
      </div>

      {/* Reach: 전체 | 그룹 | 개인(채팅만). Plus the target picker. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant={reachScope === 'all' ? 'secondary' : 'ghost'}
            onClick={() => pickReach('all')}
          >
            {t('chatReachAll')}
          </Button>
          {groups.length > 0 && (
            <Button
              size="xs"
              variant={reachScope === 'group' ? 'secondary' : 'ghost'}
              onClick={() => pickReach('group')}
            >
              {t('chatReachGroup')}
            </Button>
          )}
          {kind === 'chat' && candidates.length > 0 && (
            <Button
              size="xs"
              variant={reachScope === 'personal' ? 'secondary' : 'ghost'}
              onClick={() => pickReach('personal')}
            >
              {t('chatReachPersonal')}
            </Button>
          )}
        </div>

        {reachScope === 'group' && groups.length > 0 && (
          <Select
            aria-label={t('chatGroupPickerLabel')}
            size="sm"
            fullWidth={false}
            className="w-40 truncate"
            value={groupTarget}
            onChange={(e) => setGroupTarget(e.target.value)}
            options={groups.map((g) => ({ value: g.id, label: g.title }))}
          />
        )}
        {reachScope === 'personal' && candidates.length > 0 && (
          <Select
            aria-label={t('chatPersonalPickerLabel')}
            size="sm"
            fullWidth={false}
            className="w-40 truncate"
            value={isBroadcast ? '' : selectedThread}
            onChange={(e) => selectThread(e.target.value)}
            options={candidates.map((c) => ({ value: c.id, label: c.label }))}
          />
        )}
      </div>
    </div>
  );

  // --- Assigned-schedule panel (sidebar only): scope-filtered slots, click → edit ---
  const slotPanel = slots && (
    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto border-b border-line-soft px-4 py-3">
      <p className="text-xs font-medium text-mute">{t('chatScheduleHeading')}</p>
      {scopedSlots.length === 0 ? (
        <p className="text-xs text-mute-soft">{t('chatScheduleEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {scopedSlots.map((s) => {
            const label =
              s.title ||
              (s.candidate_id
                ? (candidateLabelById.get(s.candidate_id) ??
                  t('unnamedCandidate'))
                : t('chatBroadcast'));
            return (
              <li key={s.id}>
                {/* eslint-disable-next-line react/forbid-elements -- full-width multiline slot row opening the slot editor; Button primitive chrome unsuitable */}
                <button
                  type="button"
                  onClick={() => onEditSlot?.(s)}
                  className="flex w-full items-center gap-2 py-1.5 text-left text-xs transition-colors hover:text-ink"
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.status === 'confirmed'
                        ? 'bg-success'
                        : s.status === 'cancelled'
                          ? 'bg-mute-soft'
                          : 'bg-amore'
                    }`}
                  />
                  <span className="shrink-0 text-mute">
                    {timeFmt.format(new Date(s.start_at))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={label}>
                    {label}
                  </span>
                  <span className="shrink-0 text-mute-soft">
                    {statusLabel[s.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // --- Message history ---
  const messageList = (
    <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {loading && threadMessages.length === 0 ? (
        <p className="text-sm text-mute-soft">{t('chatLoading')}</p>
      ) : threadMessages.length === 0 ? (
        <p className="text-sm text-mute-soft">{t('chatEmpty')}</p>
      ) : (
        threadMessages.map((m) => {
          const fromAdmin = m.sender_role === 'admin';
          return (
            <div
              key={m.id}
              className={[
                'flex flex-col gap-1',
                fromAdmin ? 'items-end' : 'items-start',
              ].join(' ')}
            >
              <div
                className={[
                  'max-w-[85%] whitespace-pre-wrap rounded-sm border px-3 py-2 text-sm',
                  fromAdmin
                    ? 'border-amore/40 bg-amore/5 text-ink'
                    : 'border-line bg-paper text-ink',
                ].join(' ')}
              >
                {m.body}
              </div>
              <span className="text-xs text-mute-soft">
                {fromAdmin ? t('chatSenderAdmin') : t('chatSenderParticipant')}
                {' · '}
                {timeFmt.format(new Date(m.created_at))}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  // --- Composer: input + send only (kind/reach moved up into the hierarchy) ---
  const composer = (
    <div className="border-t border-line-soft p-3">
      {error && <p className="mb-2 text-sm text-warning">{error}</p>}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={t('chatComposerLabel')}
          placeholder={
            isPersonal
              ? t('chatComposerPrivatePlaceholder')
              : t('chatComposerBroadcastPlaceholder')
          }
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="resize-none"
        />
        <Button
          variant="primary"
          onClick={() => void send()}
          disabled={!draft.trim() || sending || !sendReady}
        >
          {sending ? t('chatSending') : t('chatSend')}
        </Button>
      </div>
    </div>
  );

  // --- Sidebar layout (unified calendar view) ---
  if (layout === 'sidebar') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
          <p className="truncate text-sm font-medium text-ink">
            {t('tabChat')}
          </p>
          {onClose && (
            <IconButton
              aria-label={t('chatClose')}
              variant="ghost"
              size="sm"
              onClick={onClose}
            >
              ✕
            </IconButton>
          )}
        </div>

        {hierarchy}
        {slotPanel}
        {messageList}
        {composer}
      </div>
    );
  }

  // --- Classic two-pane panel layout ---
  return (
    <div className="flex min-h-[28rem] gap-4 rounded-sm border border-line">
      {/* Thread list */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-line-soft">
        {/* eslint-disable-next-line react/forbid-elements -- custom full-width multiline thread-row selector; Button primitive chrome unsuitable */}
        <button
          type="button"
          onClick={() => pickReach('all')}
          className={[
            'flex w-full flex-col items-start gap-0.5 border-b border-line-soft px-4 py-3 text-left transition-colors',
            isBroadcast ? 'bg-paper-soft text-ink' : 'text-mute hover:text-ink',
          ].join(' ')}
        >
          <span className="text-sm font-medium">{t('chatBroadcast')}</span>
          <span className="text-xs text-mute-soft">
            {t('chatBroadcastHint')}
          </span>
        </button>

        {candidates.length === 0 ? (
          <p className="px-4 py-3 text-xs text-mute-soft">
            {t('chatNoCandidates')}
          </p>
        ) : (
          candidates.map((c) => {
            const active = !isBroadcast && selectedThread === c.id;
            const count = byCandidate.get(c.id)?.length ?? 0;
            return (
              // eslint-disable-next-line react/forbid-elements -- custom full-width thread-row selector; Button primitive chrome unsuitable
              <button
                key={c.id}
                type="button"
                onClick={() => selectThread(c.id)}
                className={[
                  'flex w-full items-center justify-between gap-2 border-b border-line-soft px-4 py-3 text-left text-sm transition-colors',
                  active ? 'bg-paper-soft text-ink' : 'text-mute hover:text-ink',
                ].join(' ')}
              >
                <span className="truncate">{c.label}</span>
                {count > 0 && (
                  <span className="shrink-0 text-xs text-mute-soft">
                    {count}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Thread messages + composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line-soft px-4 py-3">
          <p className="text-sm font-medium text-ink">{threadTitle}</p>
          <p className="text-xs text-mute-soft">
            {isBroadcast ? t('chatBroadcastHint') : t('chatPrivateHint')}
          </p>
        </div>

        {hierarchy}
        {messageList}
        {composer}
      </div>
    </div>
  );
}
