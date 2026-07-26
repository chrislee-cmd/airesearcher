'use client';

import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

// smsEligible = 합류 확인(joined_at) ∩ 전화 보유. 개인 reach 에서 문자 자격 여부
// (체크박스 비활성·사유)를 판정한다. 미제공(구 호출부)이면 undefined → 미자격 취급.
export type ChatCandidate = {
  id: string;
  label: string;
  smsEligible?: boolean;
};
// count  = 그룹 공지 수신자 집합(= 그룹 내 확정자) 수 N.
// smsCount = 그중 문자 자격(합류∩전화) M. 미제공 시 그룹 reach 힌트는 생략/0.
export type ChatGroup = {
  id: string;
  title: string;
  count?: number;
  smsCount?: number;
};

// The top-level kind toggle: 공지글(announcement banner) vs 채팅 메세지(chat bubble).
type AnnounceMode = 'announcement' | 'chat';
// The reach axis under each kind. 공지글 = [전체 | 그룹]; 채팅 = [전체 | 그룹 | 개인].
type ReachScope = 'all' | 'group' | 'personal';

type Props = {
  batchId: string;
  // Group-scoped roster (this tile's batch). Retained for thread-title
  // resolution + the 전체 count fallback.
  candidates: ChatCandidate[];
  // The 개인 reach picker's candidate pool. Unlike `candidates` (one group), this
  // is the CONFIRMED-everyone list across the whole project — a private chat can
  // target any confirmed person regardless of group (spec 항목1). Falls back to
  // `candidates` when omitted (single-group callers).
  personalCandidates?: ChatCandidate[];
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
  // 전체 공지 수신자 집합 = 프로젝트 확정자 수 N (전체 reach 힌트). 미제공 시 보이는
  // 후보 수로 폴백.
  confirmedCount?: number;
  // 확정자 중 문자 자격(합류∩전화) M — 전체 reach 의 "📱 문자 알림 (M명)".
  confirmedSmsCount?: number;
};

// Admin chat rail (CD frame 02 · reach sub-picker 02B) — a broadcast
// announcement/chat channel + one private thread per candidate, organized as a
// hierarchy: 공지글/채팅 kind segment → 전체/그룹/개인 reach radio → target
// sub-picker — mapped onto the same send API (510, payload unchanged). Messages
// are loaded + kept live by useSchedMessages (realtime + poll).
export function SchedulingChatPanel({
  batchId,
  candidates,
  personalCandidates,
  groups = [],
  selectedThread: controlledThread,
  onSelectThread,
  onClose,
  slots,
  onEditSlot,
  confirmedCount,
  confirmedSmsCount,
}: Props) {
  const t = useTranslations('RecruitingScheduling');
  const { messages, loading, refetch, editMessage, deleteMessage } =
    useSchedMessages(batchId);

  // 개인 reach targets = confirmed-everyone when the parent supplies it, else the
  // group roster (back-compat). Used for the personal picker options, its radio
  // visibility, and the 개인 landing target.
  const personalOptions = personalCandidates ?? candidates;

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
  // Inline edit of a broadcast message (round-3). editingId marks which bubble
  // is in edit mode; editDraft holds its working text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
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

  // SMS 알림(Solapi) 설정 여부 — 서버가 결정(env 3종). 미설정이면 체크박스 미노출
  // (회귀 0). 한 번만 조회(마운트 시). 비인가/에러면 false 유지.
  const [smsConfigured, setSmsConfigured] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/scheduling/sms-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.configured === 'boolean')
          setSmsConfigured(j.configured);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // 문자 알림 opt-in. 기본은 kind 파생(공지=on, 채팅=off — 사용자 결정). null 이면
  // 파생 기본을, 사용자가 토글하면(override) 그 값을 쓴다(effect 없는 파생-with-override).
  const [notifySmsOverride, setNotifySmsOverride] = useState<boolean | null>(
    null,
  );

  const { broadcast, byCandidate } = useMemo(
    () => groupMessages(messages),
    [messages],
  );

  const candidateLabelById = useMemo(() => {
    const map = new Map<string, string>();
    // Merge both pools so a personal thread targeting a confirmed candidate from
    // another group (spec 항목1) still resolves its display name.
    for (const c of candidates) map.set(c.id, c.label);
    for (const c of personalOptions) map.set(c.id, c.label);
    return map;
  }, [candidates, personalOptions]);

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

  // 문자 알림 기본값: 사용자가 안 건드렸으면(override null) kind 파생 — 공지=on /
  // 채팅=off. 토글하면 override 값 우선.
  const notifySms = notifySmsOverride ?? kind === 'announcement';

  // 두 축(사용자 결정 2026-07-26):
  //   reachRecipientCount(N) = 이 메시지가 도달하는 수신자 집합 크기
  //     (전체·그룹 공지 = 확정자, 개인 = 1).
  //   smsEligibleCount(M)    = 그중 문자 자격(합류∩전화) = 실제 문자 대상.
  // 서버가 최종 게이트라 M 은 근사(masking 뷰어는 전화 미상). N≠M 이면 왜 적게
  // 가는지 한 줄로 설명하고, M=0 이면 문자 체크박스를 비활성화한다.
  const groupCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups)
      if (typeof g.count === 'number') map.set(g.id, g.count);
    return map;
  }, [groups]);
  const groupSmsCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups)
      if (typeof g.smsCount === 'number') map.set(g.id, g.smsCount);
    return map;
  }, [groups]);
  const selectedPersonal = isPersonal
    ? personalOptions.find((c) => c.id === selectedThread)
    : undefined;
  const reachRecipientCount: number =
    reachScope === 'personal'
      ? 1
      : reachScope === 'group'
        ? (groupCountById.get(groupTarget) ??
          (groupTarget === batchId ? candidates.length : 0))
        : (confirmedCount ?? candidates.length);
  const smsEligibleCount: number =
    reachScope === 'personal'
      ? selectedPersonal?.smsEligible
        ? 1
        : 0
      : reachScope === 'group'
        ? (groupSmsCountById.get(groupTarget) ?? 0)
        : (confirmedSmsCount ?? 0);
  // 문자 자격 대상이 하나도 없으면 발송해도 아무에게도 안 감 → 체크박스 비활성.
  const smsCanSend = smsEligibleCount > 0;
  // 수신자 집합 중 문자에서 제외되는 인원(미합류·무전화).
  const smsExcludedCount = Math.max(0, reachRecipientCount - smsEligibleCount);
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
      if (isBroadcast && personalOptions[0]) selectThread(personalOptions[0].id);
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
    // 문자 알림은 설정된 배포에서 체크됐고 실제 자격 대상이 있을 때만(smsCanSend).
    // sms_context_batch_id 는 전체 reach 에서 프로젝트를 특정하기 위한 컨텍스트(타일
    // batchId). 서버가 다시 최종 필터하지만, 여기서 막아 불필요한 호출을 줄인다.
    const smsOn = smsConfigured && notifySms && smsCanSend;
    try {
      const res = await fetch('/api/scheduling/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          body: text,
          ...(smsOn
            ? { notify_sms: true, sms_context_batch_id: batchId }
            : {}),
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
      // 메시지 저장은 성공. SMS 는 best-effort 후처리라 스킵/실패해도 채팅은 정상 —
      // 상한 초과만 사용자에게 한 줄 안내(그 외 스킵은 무음).
      if (smsOn) {
        const j = (await res.json().catch(() => null)) as {
          smsSkipped?: string;
          smsTargetCount?: number;
        } | null;
        if (j?.smsSkipped === 'limit_exceeded') {
          setError(t('chatSmsLimit', { count: j.smsTargetCount ?? 0 }));
        }
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

  // --- Broadcast message edit / delete (round-3, admin-only) ---

  function startEdit(m: SchedMessage) {
    setEditingId(m.id);
    setEditDraft(m.body);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function saveEdit(id: string) {
    const text = editDraft.trim();
    if (!text || editBusy) return;
    setEditBusy(true);
    setError(null);
    const ok = await editMessage(id, text);
    setEditBusy(false);
    if (ok) {
      setEditingId(null);
      setEditDraft('');
    } else {
      setError(t('chatEditFailed'));
    }
  }

  async function removeMessage(id: string) {
    if (typeof window !== 'undefined' && !window.confirm(t('chatMsgDeleteConfirm')))
      return;
    const ok = await deleteMessage(id);
    if (!ok) setError(t('chatDeleteFailed'));
    else if (editingId === id) cancelEdit();
  }

  const threadTitle = isBroadcast
    ? t('chatBroadcast')
    : (candidateLabelById.get(selectedThread) ?? t('unnamedCandidate'));
  const avatarLetter = isBroadcast ? '📢' : threadTitle.trim().charAt(0) || '·';
  // 전체 reach 힌트 = 공지 수신자 집합(확정자) 수.
  const allCount = confirmedCount ?? candidates.length;

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
          {kind === 'chat' && personalOptions.length > 0 && (
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
        {reachScope === 'personal' && personalOptions.length > 0 && (
          <Select
            aria-label={t('chatPersonalPickerLabel')}
            size="sm"
            className="w-full"
            value={isBroadcast ? '' : selectedThread}
            onChange={(e) => selectThread(e.target.value)}
            options={personalOptions.map((c) => ({
              value: c.id,
              label: c.label,
            }))}
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
            // "수정됨" marker — only when the row carries an edit stamp later than
            // its creation (a never-edited / preview-DB row has updated_at null).
            const edited =
              !!m.updated_at &&
              new Date(m.updated_at).getTime() >
                new Date(m.created_at).getTime();
            const stamp = `${senderLabel} · ${timeFmt.format(new Date(m.created_at))}${
              edited ? ` · ${t('chatMsgEdited')}` : ''
            }`;
            // Edit/delete are broadcast-only (private is out of round-3 scope) and
            // admin-authored — matching the [id] route's server-side gate.
            const editable = fromAdmin && m.scope === 'broadcast';
            const isEditing = editingId === m.id;

            // Shared inline editor (textarea + save/cancel), used by both the
            // banner and the bubble when this message is being edited.
            const editor = (
              <div className="flex flex-col gap-2">
                <Textarea
                  aria-label={t('chatMsgEdit')}
                  value={editDraft}
                  maxLength={MAX_MESSAGE_LENGTH}
                  rows={3}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit(m.id);
                    }
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="resize-none border-2 border-ink"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => void saveEdit(m.id)}
                    disabled={!editDraft.trim() || editBusy}
                  >
                    {t('chatMsgSave')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={cancelEdit}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            );

            // Edit/delete action pair, shown on editable messages when not
            // editing. Borderless `plain` glyphs (not the boxed `ghost` variant,
            // which renders a hard 2px square — the "각진 네모" the spec drops) with
            // a soft round hover chip; reveal-on-hover of the message (falls to a
            // low opacity so they stay tappable/keyboard-reachable, not hidden).
            const actions = editable && !isEditing && (
              <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <IconButton
                  aria-label={t('chatMsgEdit')}
                  variant="plain"
                  size="sm"
                  onClick={() => startEdit(m)}
                  className="rounded-full text-sm hover:bg-ink/10"
                >
                  ✎
                </IconButton>
                <IconButton
                  aria-label={t('chatMsgDelete')}
                  variant="plain"
                  size="sm"
                  onClick={() => void removeMessage(m.id)}
                  className="rounded-full text-sm hover:bg-ink/10"
                >
                  🗑
                </IconButton>
              </span>
            );

            // Broadcast announcement → banner (sun head + amber shadow).
            if (m.is_announcement && m.scope === 'broadcast') {
              const reachTag = m.batch_id
                ? (groupTitleById.get(m.batch_id) ?? t('chatReachGroup'))
                : t('chatReachAll');
              return (
                <div
                  key={m.id}
                  className="group overflow-hidden rounded-sm border-2 border-ink bg-warning-bg shadow-memphis-md-amber"
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
                  {isEditing ? (
                    <div className="px-3 py-2.5">{editor}</div>
                  ) : (
                    <div className="whitespace-pre-wrap px-3 py-2.5 text-sm leading-relaxed text-ink-2">
                      {m.body}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 px-3 pb-2">
                    <span className="text-xs text-mute-soft">{stamp}</span>
                    {actions}
                  </div>
                </div>
              );
            }

            // Admin chat bubble (right, amore) vs participant bubble (left, paper).
            return (
              <div
                key={m.id}
                className={`group flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}
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
                  {isEditing ? (
                    editor
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
                      {m.body}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-mute-soft">{stamp}</span>
                    {actions}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer — border-2 ink field + ➤ ink button. */}
      <div className="shrink-0 border-t-2 border-ink bg-paper p-3">
        {error && <p className="mb-2 text-sm text-warning">{error}</p>}
        {/* 문자 알림 opt-in — Solapi 설정된 배포에서만 노출. 대상 수(M명)=문자 자격
            (합류∩전화). 서버가 최종 필터라 근사. M=0 이면 비활성(보낼 사람 없음 →
            "보냈다고 착각" 방지), N>M 이면 왜 적게 가는지 한 줄 설명. */}
        {smsConfigured && (
          <div className="mb-2 flex flex-col gap-1">
            <label
              className={`flex w-fit items-center gap-2 text-sm ${
                smsCanSend
                  ? 'cursor-pointer text-mute'
                  : 'cursor-not-allowed text-mute-soft'
              }`}
            >
              <Checkbox
                checked={notifySms && smsCanSend}
                disabled={!smsCanSend}
                onChange={(e) => setNotifySmsOverride(e.target.checked)}
              />
              <span>{t('chatSmsNotify', { count: smsEligibleCount })}</span>
            </label>
            {/* 제외 사유 — M=0(대상 없음) 또는 N>M(일부 제외). 개인 reach 는 상대가
                미합류/무전화라는 개인화 문구. */}
            {!smsCanSend ? (
              <p className="text-xs leading-relaxed text-mute-soft">
                {reachScope === 'personal'
                  ? t('chatSmsPersonalIneligible')
                  : t('chatSmsNoneHint')}
              </p>
            ) : (
              smsExcludedCount > 0 && (
                <p className="text-xs leading-relaxed text-mute-soft">
                  {t('chatSmsExcludedHint', { excluded: smsExcludedCount })}
                </p>
              )
            )}
          </div>
        )}
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
