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

export type ChatCandidate = { id: string; label: string };
export type ChatGroup = { id: string; title: string };

type Props = {
  batchId: string;
  candidates: ChatCandidate[];
  // The project's named groups (assignment groups, not the inbox pool), for the
  // broadcast composer's 그룹별 reach picker. Omitted / empty → only 전체 reach.
  groups?: ChatGroup[];
  // Controlled thread selection (PR-B unified view). When provided, the parent
  // owns which thread is open — clicking a confirmed candidate elsewhere in the
  // page drives this. Omit both for the standalone two-pane behavior with its
  // own internal thread list.
  selectedThread?: string;
  onSelectThread?: (threadId: string) => void;
  // 'panel' = classic two-pane (thread list + messages). 'sidebar' = single
  // column (messages + composer) that lives in the calendar view's right rail;
  // the parent supplies thread selection + the close affordance.
  layout?: 'panel' | 'sidebar';
  onClose?: () => void;
};

// Admin chat panel (PR3): a broadcast announcement thread + one private thread
// per candidate. The admin reads/sends both; participant send/receive is PR4.
// Messages are loaded + kept live by useSchedMessages (realtime + poll).
export function SchedulingChatPanel({
  batchId,
  candidates,
  groups = [],
  selectedThread: controlledThread,
  onSelectThread,
  layout = 'panel',
  onClose,
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

  // Broadcast compose axes (only used when the broadcast thread is selected):
  //   announceMode — 공지(announcement, banner) vs 발송(chat, bubble)
  //   reachMode    — 전체(all) vs 그룹별(one group)
  //   groupTarget  — the batch id when reachMode==='group'; defaults to the
  //                  group in focus (batchId) if it's a named group, else the first.
  const [announceMode, setAnnounceMode] = useState<'announcement' | 'chat'>(
    'announcement',
  );
  const [reachMode, setReachMode] = useState<'all' | 'group'>('all');
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

  const isBroadcast = selectedThread === BROADCAST_THREAD_ID;
  const threadMessages: SchedMessage[] = isBroadcast
    ? broadcast
    : (byCandidate.get(selectedThread) ?? []);

  // Auto-scroll the message list to the newest message on thread change / new
  // message arrival.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadMessages.length, selectedThread]);

  // Group reach needs a concrete target; block send until one is chosen.
  const groupReachReady = reachMode === 'all' || !!groupTarget;

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    if (isBroadcast && !groupReachReady) return;
    setSending(true);
    setError(null);
    const scope: MessageScope = isBroadcast ? 'broadcast' : 'private';
    const batchTarget = reachMode === 'group' ? groupTarget : null;
    try {
      const res = await fetch('/api/scheduling/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          body: text,
          ...(isBroadcast
            ? {
                is_announcement: announceMode === 'announcement',
                ...(batchTarget ? { batch_id: batchTarget } : {}),
              }
            : { candidate_id: selectedThread }),
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

  // Shared message list + composer used by both layouts.
  const conversation = (
    <>
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

      <div className="border-t border-line-soft p-3">
        {error && <p className="mb-2 text-sm text-warning">{error}</p>}

        {/* Broadcast compose mode: [공지 | 발송] × [전체 | 그룹별 ▾]. Private
            threads keep the plain composer (no selector). */}
        {isBroadcast && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant={
                  announceMode === 'announcement' ? 'secondary' : 'ghost'
                }
                onClick={() => setAnnounceMode('announcement')}
              >
                {t('chatModeAnnouncement')}
              </Button>
              <Button
                size="xs"
                variant={announceMode === 'chat' ? 'secondary' : 'ghost'}
                onClick={() => setAnnounceMode('chat')}
              >
                {t('chatModeSend')}
              </Button>
            </div>
            <span className="text-mute-soft">·</span>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant={reachMode === 'all' ? 'secondary' : 'ghost'}
                onClick={() => setReachMode('all')}
              >
                {t('chatReachAll')}
              </Button>
              {groups.length > 0 && (
                <Button
                  size="xs"
                  variant={reachMode === 'group' ? 'secondary' : 'ghost'}
                  onClick={() => setReachMode('group')}
                >
                  {t('chatReachGroup')}
                </Button>
              )}
            </div>
            {reachMode === 'group' && groups.length > 0 && (
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
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            aria-label={t('chatComposerLabel')}
            placeholder={
              isBroadcast
                ? t('chatComposerBroadcastPlaceholder')
                : t('chatComposerPrivatePlaceholder')
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
            disabled={
              !draft.trim() || sending || (isBroadcast && !groupReachReady)
            }
          >
            {sending ? t('chatSending') : t('chatSend')}
          </Button>
        </div>
      </div>
    </>
  );

  // --- Sidebar layout (unified calendar view) ---
  if (layout === 'sidebar') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-medium text-ink">
              {threadTitle}
            </p>
            <p className="text-xs text-mute-soft">
              {isBroadcast ? t('chatBroadcastHint') : t('chatPrivateHint')}
            </p>
          </div>
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

        {/* Broadcast ↔ current-candidate switch. Private threads are reached by
            clicking a candidate in the confirmed list; this only needs to offer
            the always-present broadcast channel + a return chip. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2">
          <Button
            variant={isBroadcast ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => selectThread(BROADCAST_THREAD_ID)}
          >
            {t('chatBroadcast')}
          </Button>
          {!isBroadcast && (
            <span className="truncate rounded-xs bg-paper-soft px-2 py-1 text-xs text-ink">
              {threadTitle}
            </span>
          )}
        </div>

        {conversation}
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
          onClick={() => selectThread(BROADCAST_THREAD_ID)}
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
            const active = selectedThread === c.id;
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

        {conversation}
      </div>
    </div>
  );
}
