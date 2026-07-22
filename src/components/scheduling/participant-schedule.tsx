'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSchedPublic } from '@/hooks/use-sched-public';
import { MAX_MESSAGE_LENGTH, type SchedMessage } from '@/lib/scheduling/messages';
import type { SchedSlot, SlotStatus } from '@/lib/scheduling/slots';

type Props = {
  token: string;
  candidateName: string | null;
};

// Participant-facing view for the recruiting-scheduling share link (PR4). Shows
// ONLY this candidate's own data (enforced server-side by the token scope):
//   * their interview slots (read-only, rendered in the participant's local TZ)
//   * announcements (broadcast, read-only)
//   * a 1:1 thread with the admin (read + send)
// Data is polled (no anon realtime — see useSchedPublic). All UI uses design
// tokens (§9); no login, no navigation chrome.
export function ParticipantSchedule({ token, candidateName }: Props) {
  const t = useTranslations('SchedulingParticipant');
  const { slots, messages, loading, error, refetch } = useSchedPublic(token);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [],
  );
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );
  const msgTimeFmt = useMemo(
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

  // The server already scopes rows to this participant (own private + global +
  // own-group broadcasts), so here we only split by render style:
  //   * announcement broadcasts → banner list
  //   * chat broadcasts (발송) + own private → chat bubbles, oldest→newest
  // is_announcement is undefined only on a pre-migration preview row, which we
  // treat as an announcement (banner) — the legacy behavior.
  const { announcements, thread } = useMemo(() => {
    const announcements: SchedMessage[] = [];
    const thread: SchedMessage[] = [];
    for (const m of messages) {
      const isBroadcast = m.scope === 'broadcast' || m.candidate_id == null;
      if (isBroadcast && m.is_announcement !== false) announcements.push(m);
      else thread.push(m);
    }
    return { announcements, thread };
  }, [messages]);

  // Auto-scroll the private thread to newest on new message.
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(
        `/api/scheduling/public/${encodeURIComponent(token)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text }),
        },
      );
      if (!res.ok) {
        setSendError(t('sendFailed'));
        return;
      }
      setDraft('');
      await refetch();
    } catch {
      setSendError(t('sendFailed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-5 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{t('title')}</h1>
        <p className="text-sm text-mute">
          {candidateName ? t('greeting', { name: candidateName }) : t('subtitle')}
        </p>
      </header>

      {/* ── Schedule ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">{t('scheduleHeading')}</h2>
        {loading && slots.length === 0 ? (
          <p className="text-sm text-mute-soft">{t('loading')}</p>
        ) : error && slots.length === 0 ? (
          <p className="text-sm text-warning">{t('loadError')}</p>
        ) : slots.length === 0 ? (
          <p className="rounded-sm border border-line-soft bg-paper-soft px-4 py-6 text-center text-sm text-mute">
            {t('noSlots')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {slots.map((s) => (
              <SlotRow
                key={s.id}
                slot={s}
                dateFmt={dateFmt}
                timeFmt={timeFmt}
                statusLabel={statusLabel}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Announcements (broadcast, read-only) ─────────────────── */}
      {announcements.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-ink">
            {t('announcementsHeading')}
          </h2>
          <ul className="flex flex-col gap-2">
            {announcements.map((m) => (
              <li
                key={m.id}
                className="flex flex-col gap-1 rounded-sm border border-line bg-paper px-3 py-2"
              >
                <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                <span className="text-xs text-mute-soft">
                  {msgTimeFmt.format(new Date(m.created_at))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Private thread with the admin (read + send) ──────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">{t('messagesHeading')}</h2>
        <div className="flex min-h-[24rem] flex-col rounded-sm border border-line sm:min-h-[16rem]">
          <div
            ref={threadRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {loading && thread.length === 0 ? (
              <p className="text-sm text-mute-soft">{t('loading')}</p>
            ) : thread.length === 0 ? (
              <p className="text-sm text-mute-soft">{t('noMessages')}</p>
            ) : (
              thread.map((m) => {
                const mine = m.sender_role === 'participant';
                return (
                  <div
                    key={m.id}
                    className={[
                      'flex flex-col gap-1',
                      mine ? 'items-end' : 'items-start',
                    ].join(' ')}
                  >
                    <div
                      className={[
                        'max-w-[85%] whitespace-pre-wrap rounded-sm border px-3 py-2 text-sm',
                        mine
                          ? 'border-amore/40 bg-amore/5 text-ink'
                          : 'border-line bg-paper text-ink',
                      ].join(' ')}
                    >
                      {m.body}
                    </div>
                    <span className="text-xs text-mute-soft">
                      {mine ? t('senderYou') : t('senderTeam')}
                      {' · '}
                      {msgTimeFmt.format(new Date(m.created_at))}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-line-soft p-3">
            {sendError && (
              <p className="mb-2 text-sm text-warning">{sendError}</p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                aria-label={t('composerLabel')}
                placeholder={t('composerPlaceholder')}
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
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
                disabled={!draft.trim() || sending}
                className="min-h-11 shrink-0"
              >
                {sending ? t('sending') : t('send')}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// One read-only slot row: date · time range · status dot + label.
function SlotRow({
  slot,
  dateFmt,
  timeFmt,
  statusLabel,
}: {
  slot: SchedSlot;
  dateFmt: Intl.DateTimeFormat;
  timeFmt: Intl.DateTimeFormat;
  statusLabel: Record<SlotStatus, string>;
}) {
  const start = new Date(slot.start_at);
  const end = new Date(slot.end_at);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line-soft bg-paper px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          {dateFmt.format(start)}
        </span>
        <span className="text-sm text-mute">
          {timeFmt.format(start)} – {timeFmt.format(end)}
          {slot.location ? ` · ${slot.location}` : ''}
        </span>
        {slot.note && (
          <span className="text-xs text-mute-soft">{slot.note}</span>
        )}
      </div>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            slot.status === 'confirmed' ? 'bg-success' : 'bg-amore'
          }`}
        />
        <span className="text-xs text-mute">{statusLabel[slot.status]}</span>
      </span>
    </li>
  );
}
