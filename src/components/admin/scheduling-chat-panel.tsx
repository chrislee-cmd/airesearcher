'use client';

import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
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
  // Retained for prop compatibility with the client. Only the redesigned
  // sidebar (calendar rail) treatment is rendered now.
  layout?: 'panel' | 'sidebar';
  onClose?: () => void;
  // Assigned-schedule panel source: the client's slots. Filtered by the current
  // compose scope (전체=all · 그룹=batch · 개인=candidate).
  slots?: SchedSlot[];
  // Slot click → open the slot editor modal (parent's `openEdit`).
  onEditSlot?: (slot: SchedSlot) => void;
  // Total candidate count in the project (for the 전체 reach hint). Falls back
  // to the visible candidate count.
  totalCount?: number;
};

// Admin chat rail (CD frame 02 · reach sub-picker 02B) — a broadcast
// announcement/chat channel + one private thread per candidate, organized as a
// hierarchy: 공지글/채팅 kind segment → 전체/그룹/개인 reach radio → target
// sub-picker — mapped onto the same send API (510, payload unchanged). Messages
// are loaded + kept live by useSchedMessages (realtime + poll).
export function SchedulingChatPanel({
  batchId,
  candidates,
  groups = [],
  selectedThread: controlledThread,
  onSelectThread,
  onClose,
  slots,
  onEditSlot,
  totalCount,
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
  // Assigned-schedule panel — collapsed by default to keep the rail compact;
  // the toggle carries a count badge (공간 압축, 사용자 요청).
  const [slotsOpen, setSlotsOpen] = useState(false);

  // Compose hierarchy state (see the legacy header note — logic unchanged):
  //   announceMode  — 공지글(announcement, banner) vs 채팅 메세지(chat, bubble)
  //   broadcastReach — 전체(all) vs 그룹(one group), for broadcast sends only
  //   groupTarget   — the batch id when broadcastReach==='group'
  // 개인 is DERIVED from the open thread (selectedThread being a candidate id) —
  // no effect-based state sync.
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

  const groupTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) map.set(g.id, g.title);
    return map;
  }, [groups]);

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
  const isPersonal = !isBroadcast;
  // Effective hierarchy shown/sent. A candidate thread always resolves to
  // 채팅→개인; otherwise the stored broadcast kind/reach apply.
  const kind: AnnounceMode = isPersonal ? 'chat' : announceMode;
  const reachScope: ReachScope = isPersonal ? 'personal' : broadcastReach;
  const threadMessages: SchedMessage[] = isBroadcast
    ? broadcast
    : (byCandidate.get(selectedThread) ?? []);

  // Assigned-schedule slots for the current compose scope.
  const scopedSlots = useMemo(() => {
    if (!slots) return [];
    let scoped: SchedSlot[];
    if (reachScope === 'group')
      scoped = groupTarget
        ? slotsForScope(slots, { kind: 'group', batchId: groupTarget })
        : [];
    else if (reachScope === 'personal')
      scoped = isBroadcast
        ? []
        : slotsForScope(slots, {
            kind: 'personal',
            candidateId: selectedThread,
          });
    else scoped = slotsForScope(slots, { kind: 'all' });
    // Dedup by display unit — group slots fan out per candidate, repeating the
    // same time + label. Key on the label as rendered (title, else candidate
    // name / broadcast) so identical rows collapse to one representative; the
    // click still opens that representative slot's editor.
    const seen = new Set<string>();
    const unique: SchedSlot[] = [];
    for (const s of scoped) {
      const label =
        s.title ||
        (s.candidate_id
          ? (candidateLabelById.get(s.candidate_id) ?? t('unnamedCandidate'))
          : t('chatBroadcast'));
      const key = `${s.start_at}__${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(s);
    }
    return unique;
  }, [
    slots,
    reachScope,
    groupTarget,
    isBroadcast,
    selectedThread,
    candidateLabelById,
    t,
  ]);

  // Auto-scroll to the newest message on thread change / new message arrival.
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
      // Realtime will also fire, but refetch guarantees the sender sees their
      // message immediately even if the WebSocket lags.
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
  const avatarLetter = isBroadcast ? '📢' : threadTitle.trim().charAt(0) || '·';
  const allCount = totalCount ?? candidates.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {/* Header — lav band, avatar, thread title + hint, close. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b-2 border-ink bg-lav px-4 py-3">
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-md font-extrabold text-ink shadow-memphis-sm"
          aria-hidden
        >
          {avatarLetter}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-md font-extrabold text-ink">
            {threadTitle}
          </div>
          <div className="truncate text-xs text-mute">
            {isBroadcast ? t('chatBroadcastHint') : t('chatPrivateHint')}
          </div>
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

      {/* Hierarchy — compacted (사용자 승인 CD 이탈, spec 수정2): the kind segment
          and the reach radios share one wrapping row; the 전체 hint collapses to
          a single inline line and the 그룹/개인 target Select reveals inline only
          when that reach is chosen. All states (kind 2 · reach 3 · target 2)
          stay reachable — only the vertical footprint shrinks. */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            ariaLabel={t('chatKindLabel')}
            value={kind}
            onChange={pickKind}
            options={[
              {
                value: 'announcement',
                label: `📢 ${t('chatKindAnnouncement')}`,
              },
              { value: 'chat', label: `💬 ${t('chatKindChat')}` },
            ]}
          />
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-mute-soft">
            {t('chatReachLabel')}
          </span>
          <Radio
            label={t('chatReachAll')}
            selected={reachScope === 'all'}
            onSelect={() => pickReach('all')}
          />
          {groups.length > 0 && (
            <Radio
              label={t('chatReachGroup')}
              selected={reachScope === 'group'}
              onSelect={() => pickReach('group')}
            />
          )}
          {kind === 'chat' && candidates.length > 0 && (
            <Radio
              label={t('chatReachPersonal')}
              selected={reachScope === 'personal'}
              onSelect={() => pickReach('personal')}
            />
          )}
        </div>

        {/* Sub-picker reveal (02B): All=one-line hint · Group/Individual=Select. */}
        {reachScope === 'all' && (
          <p className="text-xs leading-relaxed text-mute-soft">
            {t('chatReachAllHint', { count: allCount })}
          </p>
        )}
        {reachScope === 'group' && groups.length > 0 && (
          <Select
            aria-label={t('chatGroupPickerLabel')}
            size="sm"
            className="w-full"
            value={groupTarget}
            onChange={(e) => setGroupTarget(e.target.value)}
            options={groups.map((g) => ({ value: g.id, label: g.title }))}
          />
        )}
        {reachScope === 'personal' && candidates.length > 0 && (
          <Select
            aria-label={t('chatPersonalPickerLabel')}
            size="sm"
            className="w-full"
            value={isBroadcast ? '' : selectedThread}
            onChange={(e) => selectThread(e.target.value)}
            options={candidates.map((c) => ({ value: c.id, label: c.label }))}
          />
        )}
      </div>

      {/* Slots in scope — collapsible (default collapsed, spec 수정2): a
          disclosure toggle carrying a count badge; the list expands on demand
          so the rail stays compact. Values are deduped in scopedSlots. */}
      {slots && (
        <div className="shrink-0 border-b border-line-soft">
          {/* eslint-disable-next-line react/forbid-elements -- full-width disclosure toggle (heading + count badge + chevron); Button primitive chrome unsuitable for a bare list header */}
          <button
            type="button"
            aria-expanded={slotsOpen}
            onClick={() => setSlotsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-paper-soft"
          >
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-mute-soft">
              {t('chatScheduleHeading')}
            </span>
            <span className="inline-flex min-w-5 items-center justify-center rounded-pill border-2 border-ink bg-paper px-1.5 py-px font-mono text-xs font-bold text-ink">
              {scopedSlots.length}
            </span>
            <span
              className={`ml-auto text-xs text-mute transition-transform ${slotsOpen ? 'rotate-180' : ''}`}
              aria-hidden
            >
              ▾
            </span>
          </button>
          {slotsOpen &&
            (scopedSlots.length === 0 ? (
              <p className="px-4 pb-2.5 text-xs text-mute-soft">
                {t('chatScheduleEmpty')}
              </p>
            ) : (
              <ul className="max-h-[118px] overflow-y-auto">
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
                      className="flex w-full items-center gap-2.5 border-t border-line-soft px-4 py-2 text-left transition-colors hover:bg-paper-soft"
                    >
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${slotDot(s.status)}`}
                      />
                      <span className="shrink-0 font-mono text-xs font-bold text-ink">
                        {timeFmt.format(new Date(s.start_at))}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-mute"
                        title={label}
                      >
                        {label}
                      </span>
                      <span className="shrink-0 text-xs font-bold text-amore">
                        {t('chatSlotEdit')}
                      </span>
                    </button>
                  </li>
                );
              })}
              </ul>
            ))}
        </div>
      )}

      {/* Messages — announcement banner vs chat bubbles. */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading && threadMessages.length === 0 ? (
          <p className="text-sm text-mute-soft">{t('chatLoading')}</p>
        ) : threadMessages.length === 0 ? (
          <p className="text-sm text-mute-soft">{t('chatEmpty')}</p>
        ) : (
          threadMessages.map((m) => {
            const fromAdmin = m.sender_role === 'admin';
            const senderLabel = fromAdmin
              ? t('chatSenderAdmin')
              : t('chatSenderParticipant');
            const stamp = `${senderLabel} · ${timeFmt.format(new Date(m.created_at))}`;

            // Broadcast announcement → banner (sun head + amber shadow).
            if (m.is_announcement && m.scope === 'broadcast') {
              const reachTag = m.batch_id
                ? (groupTitleById.get(m.batch_id) ?? t('chatReachGroup'))
                : t('chatReachAll');
              return (
                <div
                  key={m.id}
                  className="overflow-hidden rounded-sm border-2 border-ink bg-warning-bg shadow-memphis-md-amber"
                >
                  <div
                    className="flex items-center gap-1.5 border-b-2 border-ink px-3 py-1.5"
                    style={{ background: 'var(--widget-header-bg-sun)' }}
                  >
                    <span className="text-xs" aria-hidden>
                      📢
                    </span>
                    <span className="font-mono text-xs font-extrabold uppercase tracking-wider text-ink">
                      {t('chatKindAnnouncement')} · {reachTag}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap px-3 py-2.5 text-sm leading-relaxed text-ink-2">
                    {m.body}
                  </div>
                  <div className="px-3 pb-2 text-xs text-mute-soft">{stamp}</div>
                </div>
              );
            }

            // Admin chat bubble (right, amore) vs participant bubble (left, paper).
            return (
              <div
                key={m.id}
                className={fromAdmin ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={[
                    'max-w-[85%] px-3 py-2.5',
                    // design-allow-hardcoded -- CD frame 02 chat-bubble radius 13px (documented outlier band, PROJECT.md §9); tail corner uses rounded-xs(4) token
                    'rounded-[13px]',
                    fromAdmin
                      ? 'rounded-br-xs border-2 border-ink bg-amore-bg shadow-memphis-sm'
                      : 'rounded-bl-xs border-[1.5px] border-line bg-paper shadow-memphis-sm-faint',
                  ].join(' ')}
                >
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
                    {m.body}
                  </div>
                  <div className="mt-1 text-xs text-mute-soft">{stamp}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer — border-2 ink field + ➤ ink button. */}
      <div className="shrink-0 border-t-2 border-ink bg-paper p-3">
        {error && <p className="mb-2 text-sm text-warning">{error}</p>}
        <div className="flex items-end gap-2.5">
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
            className="resize-none border-2 border-ink"
          />
          {/* eslint-disable-next-line react/forbid-elements -- CD send affordance: 44×44 ink Memphis square (2px hard shadow); no Button/IconButton variant reproduces the square ink fill + offset shadow */}
          <button
            type="button"
            aria-label={t('chatSend')}
            onClick={() => void send()}
            disabled={!draft.trim() || sending || !sendReady}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-ink bg-ink text-lg text-paper shadow-memphis-sm transition-opacity disabled:opacity-40"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

function slotDot(status: SlotStatus): string {
  return status === 'confirmed'
    ? 'bg-slot-confirmed-dot'
    : status === 'cancelled'
      ? 'bg-slot-cancelled-dot'
      : 'bg-slot-proposed-dot';
}

// Reach radio (CD frame 02B) — 16px circle, 2px ink border, filled = 8px ink
// dot. Native button (radio semantics) because no primitive renders this.
function Radio({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD reach radio (16px circle · 2px ink · 8px ink dot); no primitive renders a radio control
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
        selected ? 'font-extrabold text-ink' : 'font-semibold text-mute'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-ink' : 'border-line'
        }`}
      >
        {selected && (
          <span className="h-2 w-2 rounded-full bg-ink" aria-hidden />
        )}
      </span>
      {label}
    </button>
  );
}

// Memphis segmented control (ink-fill active segment). fullWidth stretches each
// segment (chat kind toggle spans the rail).
function Segmented<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
  fullWidth,
}: {
  ariaLabel: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  fullWidth?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex overflow-hidden rounded-pill border-2 border-ink shadow-memphis-sm ${
        fullWidth ? 'flex w-full' : 'shrink-0'
      }`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          // eslint-disable-next-line react/forbid-elements -- CD Memphis segmented pill (ink-fill active seg); a per-Button border/shadow/radius can't compose into one unified control
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={[
              fullWidth ? 'flex-1 text-center' : '',
              'px-4 py-1.5 text-sm font-bold transition-colors',
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
