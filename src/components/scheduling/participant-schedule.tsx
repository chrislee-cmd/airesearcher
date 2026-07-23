'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/ui/icon-button';
import { useSchedPublic } from '@/hooks/use-sched-public';
import { MAX_MESSAGE_LENGTH, type SchedMessage } from '@/lib/scheduling/messages';
import type { SchedSlot, SlotStatus } from '@/lib/scheduling/slots';

type Props = {
  token: string;
  candidateName: string | null;
};

// Participant-facing view for the recruiting-scheduling share link, redesigned
// to the Memphis system (CD frame 04 "Participant view"). Shows ONLY this
// candidate's own data (enforced server-side by the token scope):
//   * their interview slots (read-only, rendered in the participant's local TZ,
//     with the free-text slot title the admin exposes to participants)
//   * announcements (broadcast, read-only) — banner treatment
//   * a 1:1 thread with the admin (read + send) — chat bubbles
// Data is polled (no anon realtime — see useSchedPublic). Presentation is a
// fresh Memphis build (CD SSOT); only the data/split/send logic is reused. All
// surfaces bind to design tokens (§9) — no hardcoded hex, no arbitrary
// shadows/radii (shadow-memphis-* / rounded-{xs,sm,md,full} only).

// Display font stacks (consumed inline, same pattern as WidgetFullviewPanel):
// Outfit 800 for the screen title + big day numeral, ui-monospace for the
// eyebrow labels / banner tag / date-chip month. --font-outfit is defined in
// schedule/layout.tsx (this route is outside `(app)`).
const OUTFIT = 'var(--font-outfit), var(--font-sans)';
const MONO = 'ui-monospace, Menlo, monospace';

export function ParticipantSchedule({ token, candidateName }: Props) {
  const t = useTranslations('SchedulingParticipant');
  const { slots, messages, loading, error, refetch } = useSchedPublic(token);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'long' }),
    [],
  );
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'short' }),
    [],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: 'numeric' }),
    [],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
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

  // Auto-scroll the scroll body to newest on new message.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
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
    // Memphis screen frame (CD 04). The fixed 760×900 device box in the comp is
    // mockup chrome; the real page owns its W×H responsively — full-bleed on
    // phones, a floating framed card on desktop. Only the border/radius/shadow/
    // header-tone/typography are CD absolutes.
    <div className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col overflow-hidden border-[3px] border-ink bg-paper sm:my-6 sm:min-h-0 sm:h-[calc(100dvh-3rem)] sm:rounded-sm sm:shadow-memphis-2xl">
      {/* ── Sky header band (participant identity tone) ───────────── */}
      <header className="flex shrink-0 items-center gap-3 border-b-[3px] border-ink bg-sky px-[22px] py-[15px]">
        <span aria-hidden="true" style={{ fontSize: 20 }}>
          📅
        </span>
        <h1
          className="flex-1 truncate text-ink"
          style={{ fontFamily: OUTFIT, fontWeight: 800, fontSize: 20, letterSpacing: '-0.4px' }}
        >
          {t('title')}
        </h1>
        {candidateName ? (
          <span className="inline-flex shrink-0 items-center rounded-full border-2 border-ink bg-paper px-3 py-1 text-sm font-bold text-ink shadow-memphis-sm">
            {candidateName}
          </span>
        ) : null}
      </header>

      {/* ── Scroll body ──────────────────────────────────────────── */}
      <div
        ref={bodyRef}
        className="flex flex-1 flex-col gap-[18px] overflow-y-auto bg-paper px-[22px] py-5"
      >
        {/* Schedule */}
        <section>
          <Eyebrow>{t('scheduleHeading')}</Eyebrow>
          {loading && slots.length === 0 ? (
            <p className="text-md text-mute-soft">{t('loading')}</p>
          ) : error && slots.length === 0 ? (
            <p className="text-md text-warning">{t('loadError')}</p>
          ) : slots.length === 0 ? (
            <p className="rounded-sm border-2 border-ink bg-paper-soft px-4 py-6 text-center text-md text-mute">
              {t('noSlots')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {slots.map((s) => (
                <SlotCard
                  key={s.id}
                  slot={s}
                  weekdayFmt={weekdayFmt}
                  monthFmt={monthFmt}
                  dayFmt={dayFmt}
                  timeFmt={timeFmt}
                  statusLabel={statusLabel}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Announcements (broadcast, read-only) — banner treatment */}
        {announcements.length > 0 && (
          <section>
            <Eyebrow>{t('announcementsHeading')}</Eyebrow>
            <ul className="flex flex-col gap-2.5">
              {announcements.map((m) => (
                <li key={m.id}>
                  <div className="overflow-hidden rounded-sm border-2 border-ink bg-warning-bg shadow-memphis-md-amber">
                    <div className="flex items-center gap-[7px] border-b-2 border-ink bg-sun px-[13px] py-1.5">
                      <span aria-hidden="true" style={{ fontSize: 12 }}>
                        📢
                      </span>
                      <span
                        className="uppercase text-ink"
                        style={{ fontFamily: MONO, fontWeight: 800, fontSize: 10, letterSpacing: '0.08em' }}
                      >
                        {t('announcementsHeading')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap px-3.5 py-3 text-lg leading-relaxed text-ink-2">
                      {m.body}
                    </p>
                    <p className="px-3.5 pb-2.5 text-sm text-mute-soft">
                      {t('senderTeam')} · {msgTimeFmt.format(new Date(m.created_at))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Private thread with the admin — chat bubbles */}
        <section className="flex flex-1 flex-col">
          <Eyebrow>{t('messagesHeading')}</Eyebrow>
          <div className="flex flex-col gap-3">
            {loading && thread.length === 0 ? (
              <p className="text-md text-mute-soft">{t('loading')}</p>
            ) : thread.length === 0 ? (
              <p className="text-md text-mute-soft">{t('noMessages')}</p>
            ) : (
              thread.map((m) => {
                const mine = m.sender_role === 'participant';
                return (
                  <div
                    key={m.id}
                    className={[
                      'max-w-[82%] whitespace-pre-wrap border-ink px-3.5 py-[11px] text-lg leading-normal text-ink-2',
                      mine
                        ? 'self-end rounded-sm rounded-br-xs border-2 bg-sky shadow-memphis-sm'
                        : 'self-start rounded-sm rounded-bl-xs border-[1.5px] border-line bg-paper shadow-memphis-sm-faint',
                    ].join(' ')}
                  >
                    {m.body}
                    <span
                      className={`mt-1 block text-xs-soft ${mine ? 'text-mute' : 'text-mute-soft'}`}
                    >
                      {mine ? t('senderYou') : t('senderTeam')}
                      {' · '}
                      {msgTimeFmt.format(new Date(m.created_at))}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ── Composer ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t-2 border-ink bg-paper px-4 py-[13px]">
        {sendError && <p className="mb-2 text-sm text-warning">{sendError}</p>}
        <div className="flex items-end gap-[9px]">
          <Textarea
            aria-label={t('composerLabel')}
            placeholder={t('composerPlaceholder')}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            // 16px floor prevents iOS Safari's focus auto-zoom (< 16px inputs
            // trigger it), which was zooming the participant view and pushing the
            // send button off-screen. Inline fontSize is this file's CD idiom and
            // overrides the Textarea primitive's text-lg (13px) base.
            style={{ fontSize: 16 }}
            className="min-h-11 !rounded-sm !border-2 !border-ink resize-none"
          />
          <IconButton
            variant="bordered"
            aria-label={t('send')}
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="h-[46px] w-[46px] shrink-0 !rounded-sm !bg-ink !text-paper disabled:opacity-40"
          >
            <span aria-hidden="true" style={{ fontSize: 17 }}>
              ➤
            </span>
          </IconButton>
        </div>
      </div>
    </div>
  );
}

// Mono eyebrow label above each section (CD 04: "Your slot" / "Announcements"
// / "Messages").
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-2.5 uppercase text-mute-soft"
      style={{ fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '1px' }}
    >
      {children}
    </p>
  );
}

// Per-status Memphis treatment for the slot card date chip + colored shadow +
// status pill (CD 04 shows the confirmed variant; proposed/cancelled follow the
// slot-status token family from BUILD-SPEC §2).
const SLOT_TONE: Record<
  SlotStatus,
  { shadow: string; chip: string; chipText: string; pill: string; dot: string }
> = {
  confirmed: {
    shadow: 'shadow-memphis-md-success',
    chip: 'bg-success-soft',
    chipText: 'text-success',
    pill: 'border-success/30 bg-success-soft text-success',
    dot: 'bg-slot-confirmed-dot',
  },
  proposed: {
    shadow: 'shadow-memphis-md-amore',
    chip: 'bg-slot-proposed-bg',
    chipText: 'text-amore',
    pill: 'border-amore/30 bg-slot-proposed-bg text-amore',
    dot: 'bg-slot-proposed-dot',
  },
  cancelled: {
    shadow: 'shadow-memphis-sm-faint',
    chip: 'bg-paper-soft',
    chipText: 'text-mute-soft',
    pill: 'border-line bg-paper-soft text-mute-soft',
    dot: 'bg-slot-cancelled-dot',
  },
};

function SlotCard({
  slot,
  weekdayFmt,
  monthFmt,
  dayFmt,
  timeFmt,
  statusLabel,
}: {
  slot: SchedSlot;
  weekdayFmt: Intl.DateTimeFormat;
  monthFmt: Intl.DateTimeFormat;
  dayFmt: Intl.DateTimeFormat;
  timeFmt: Intl.DateTimeFormat;
  statusLabel: Record<SlotStatus, string>;
}) {
  const start = new Date(slot.start_at);
  const end = new Date(slot.end_at);
  const tone = SLOT_TONE[slot.status];
  const cancelled = slot.status === 'cancelled';
  // Heading = the participant-facing slot title when present, else the weekday.
  const heading = slot.title?.trim() || weekdayFmt.format(start);
  return (
    <li
      className={`flex items-center gap-3.5 rounded-sm border-[3px] border-ink bg-paper px-[18px] py-4 ${tone.shadow}`}
    >
      {/* Date chip */}
      <span
        className={`flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center rounded-sm border-2 border-ink ${tone.chip}`}
      >
        <span
          className={`uppercase ${tone.chipText}`}
          style={{ fontFamily: MONO, fontWeight: 700, fontSize: 9 }}
        >
          {monthFmt.format(start)}
        </span>
        <span
          className="text-ink"
          style={{ fontFamily: OUTFIT, fontWeight: 800, fontSize: 20, lineHeight: 1 }}
        >
          {dayFmt.format(start)}
        </span>
      </span>

      {/* Title + time + details */}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-2xl font-extrabold text-ink ${cancelled ? 'line-through' : ''}`}
        >
          {heading}
        </p>
        <p className="mt-0.5 text-md text-mute">
          {timeFmt.format(start)} – {timeFmt.format(end)}
          {slot.location ? ` · ${slot.location}` : ''}
        </p>
        {slot.note && (
          <p className="mt-0.5 text-sm text-mute-soft">{slot.note}</p>
        )}
      </div>

      {/* Status pill */}
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-md font-bold ${tone.pill}`}
      >
        <span className={`h-[7px] w-[7px] rounded-full ${tone.dot}`} />
        {statusLabel[slot.status]}
      </span>
    </li>
  );
}
