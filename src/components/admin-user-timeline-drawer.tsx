'use client';

/* ────────────────────────────────────────────────────────────────────
   User-observation drawer — super-admin only.

   Opens from the right when a super-admin clicks a signup-roster email,
   showing that user's reconstructed activity: a deterministic summary
   header (sessions · dwell · funnel · top features · credits) over a
   reverse-chronological, day-grouped timeline merged from every domain
   table. On-demand fetch from /api/admin/users/[id]/timeline; "더보기"
   pages older events with a created_at cursor. Read-only — observe only.

   Privacy note: this surfaces raw per-user detail (a deliberate departure
   from the aggregate-only dashboard); the API gate is super-admin and each
   open is audit-logged server-side.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './ui/modal';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import type {
  TimelineCategory,
  TimelineEvent,
  UserTimeline,
  UserTimelineSummary,
} from '@/lib/admin/user-timeline';

type Props = {
  userId: string | null;
  email: string | null;
  open: boolean;
  onClose: () => void;
};

const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  account: '계정',
  integration: '연동',
  project: '프로젝트',
  interview: '인터뷰',
  transcript: '전사',
  desk: '데스크',
  video: '영상',
  probing: '프로빙',
  recruiting: '모집',
  scheduler: '스케줄러',
  payment: '결제',
  credit: '크레딧',
  auth: '인증',
  activity: '클릭',
};

// Milestone-ish categories get the single amore accent; everything else the
// neutral tag (design system is single-accent — no rainbow of colours).
const ACCENT_CATEGORIES: ReadonlySet<TimelineCategory> = new Set([
  'account',
  'payment',
]);

export function UserTimelineDrawer({ userId, email, open, onClose }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<UserTimelineSummary | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale response from a previously-viewed user landing
  // after the admin has already clicked a different row.
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (before: string | null) => {
      if (!userId) return;
      const my = ++reqId.current;
      if (before) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (before) qs.set('before', before);
        const res = await fetch(
          `/api/admin/users/${userId}/timeline${qs.toString() ? `?${qs}` : ''}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as UserTimeline;
        if (my !== reqId.current) return; // superseded by a newer click
        setEvents((prev) => (before ? [...prev, ...data.events] : data.events));
        setHasMore(data.hasMore);
        setCursor(data.nextCursor);
        if (!before && data.summary) setSummary(data.summary);
      } catch (e) {
        if (my !== reqId.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === reqId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [userId],
  );

  // Load the first page whenever the drawer opens for a (new) user. No manual
  // state reset here (that would be a set-state-in-effect): fetchPage(null)
  // *replaces* events/summary/cursor from the response, and `loading` (set
  // synchronously at the top of fetchPage) hides the previous user's content
  // through the swap, so there's no stale flash.
  useEffect(() => {
    if (!open || !userId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate data-fetch-on-open: fetchPage flips `loading` then hydrates from /api/admin/users/[id]/timeline. The reqId guard drops stale responses.
    void fetchPage(null);
  }, [open, userId, fetchPage]);

  return (
    <Modal open={open} onClose={onClose} side="right" title={email ?? '유저 관찰'}>
      <div className="space-y-5">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-md text-mute-soft">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-md text-warning rounded-sm">
              타임라인을 불러오지 못했습니다: {error}
            </div>
            <Button variant="secondary" size="sm" onClick={() => void fetchPage(null)}>
              다시 시도
            </Button>
          </div>
        ) : (
          <>
            {summary && <SummaryHeader summary={summary} />}
            {events.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-md text-mute-soft">
                기록된 활동이 없습니다.
              </div>
            ) : (
              <Timeline events={events} />
            )}
            {hasMore && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void fetchPage(cursor)}
                >
                  {loadingMore ? '불러오는 중…' : '더보기'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── summary header ─────────────────────────────────────────────────────
function SummaryHeader({ summary }: { summary: UserTimelineSummary }) {
  return (
    <section className="space-y-4 border-b border-line pb-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric label="세션 (로그인)" value={summary.totalSessions.toLocaleString()} />
        <Metric label="마지막 활동" value={fmtDate(summary.lastActivityAt)} />
        <Metric
          label="크레딧 구매"
          value={`${summary.creditsPurchased.toLocaleString()}cr`}
          sub={summary.amountPaidKrw > 0 ? `₩${summary.amountPaidKrw.toLocaleString()}` : undefined}
        />
        <Metric label="크레딧 사용" value={`${summary.creditsSpent.toLocaleString()}cr`} />
        <Metric label="처리 미디어 (근사)" value={fmtDuration(summary.mediaProcessedMs)} />
        <Metric label="가입" value={fmtDate(summary.signupAt)} />
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
          퍼널
        </div>
        <div className="flex flex-wrap gap-1.5">
          {summary.funnel.map((stage) => {
            const reached = Boolean(stage.reachedAt);
            return (
              <Badge key={stage.key} variant={reached ? 'amore' : 'subtle'} size="sm">
                {reached ? '● ' : '○ '}
                {stage.label}
              </Badge>
            );
          })}
        </div>
      </div>

      {summary.topFeatures.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            주사용 기능
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.topFeatures.map((f) => (
              <Badge key={f.feature} variant="neutral" size="sm">
                {f.feature} · {f.count}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs-soft uppercase tracking-[0.12em] text-mute-soft">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs-soft tabular-nums text-mute">{sub}</div>}
    </div>
  );
}

// ── timeline list (day-grouped) ────────────────────────────────────────
function Timeline({ events }: { events: TimelineEvent[] }) {
  const groups = groupByDay(events);
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.day}>
          <div className="sticky top-0 z-cell-sticky -mx-1 mb-2 bg-paper px-1 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
            {group.day}
          </div>
          <ol className="space-y-2.5 border-l border-line-soft pl-4">
            {group.events.map((ev, i) => (
              <TimelineRow key={`${ev.ts}-${i}`} event={ev} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const accent = ACCENT_CATEGORIES.has(event.category);
  return (
    <li className="relative">
      {/* node on the rail */}
      <span
        aria-hidden
        className={[
          'absolute -left-[1.3125rem] top-1.5 h-2 w-2 rounded-full border',
          accent ? 'border-amore bg-amore' : 'border-line bg-paper',
        ].join(' ')}
      />
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 tabular-nums text-xs-soft text-mute-soft">
            {fmtTime(event.ts)}
          </span>
          <Badge variant={accent ? 'amore' : 'subtle'} size="sm">
            {CATEGORY_LABEL[event.category]}
          </Badge>
          <span className="truncate text-md text-ink">{event.action}</span>
        </div>
        {event.artifact && (
          <span className="shrink-0 tabular-nums text-xs-soft text-mute">
            {event.artifact.label}
          </span>
        )}
      </div>
      {(event.detail || event.status || event.durationMs != null) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[3.25rem] text-xs-soft text-mute">
          {event.detail && <span className="truncate">{event.detail}</span>}
          {event.status && (
            <span className="tabular-nums text-mute-soft">· {event.status}</span>
          )}
          {event.durationMs != null && (
            <span className="tabular-nums text-mute-soft">· {fmtDuration(event.durationMs)}</span>
          )}
        </div>
      )}
    </li>
  );
}

// ── formatting ─────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const hours = ms / 3_600_000;
  return `${hours.toFixed(1)}시간`;
}

function groupByDay(events: TimelineEvent[]): { day: string; events: TimelineEvent[] }[] {
  const out: { day: string; events: TimelineEvent[] }[] = [];
  let current: { day: string; events: TimelineEvent[] } | null = null;
  for (const ev of events) {
    const day = fmtDate(ev.ts);
    if (!current || current.day !== day) {
      current = { day, events: [] };
      out.push(current);
    }
    current.events.push(ev);
  }
  return out;
}
