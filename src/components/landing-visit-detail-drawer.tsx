'use client';

/* ────────────────────────────────────────────────────────────────────
   Landing visit detail drawer (card #499) — super-admin only.

   Opens from the right when a super-admin clicks a data point on the
   랜딩 접속자 추이 chart, showing the individual `landing_visits` rows for
   that Asia/Seoul day: 시각 · country · referrer(host) · UTM · session. Every
   field the table actually stores is surfaced (empty → '—'); there is no raw
   IP (privacy design — coarse country only) and user_agent is out of scope,
   noted in the footer hint.

   On-demand fetch from /api/admin/analytics/landing-visits?day=YYYY-MM-DD.
   Read-only — observe only. The gate is super-admin (the route 404s otherwise),
   so this drawer is only wired into the admin dashboard, never the public
   /status widget board.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './ui/modal';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import type { LandingVisitDetail, LandingVisitRow } from '@/lib/admin/analytics';

type Props = {
  // Full Asia/Seoul day (YYYY-MM-DD) to detail, or null when closed.
  day: string | null;
  open: boolean;
  onClose: () => void;
};

export function LandingVisitDetailDrawer({ day, open, onClose }: Props) {
  const [detail, setDetail] = useState<LandingVisitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale response from a previously-clicked day landing
  // after the admin has already clicked a different data point.
  const reqId = useRef(0);

  const fetchDetail = useCallback(async (targetDay: string) => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ day: targetDay });
      const res = await fetch(`/api/admin/analytics/landing-visits?${qs}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LandingVisitDetail;
      if (my !== reqId.current) return; // superseded by a newer click
      setDetail(data);
    } catch (e) {
      if (my !== reqId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, []);

  // Fetch whenever the drawer opens for a (new) day. `loading` (set
  // synchronously at the top of fetchDetail) hides the previous day's content
  // through the swap; the reqId guard drops stale responses.
  useEffect(() => {
    if (!open || !day) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetch-on-open: fetchDetail flips `loading` then hydrates from /api/admin/analytics/landing-visits. The reqId guard drops stale responses.
    void fetchDetail(day);
  }, [open, day, fetchDetail]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      side="right"
      title={day ? `${day} 방문 상세` : '방문 상세'}
      description="landing_visits 개별 방문 — country · referrer · UTM · session · 시각"
    >
      <div className="space-y-5">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-md text-mute-soft">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-md text-warning rounded-sm">
              방문 상세를 불러오지 못했습니다: {error}
            </div>
            {day && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchDetail(day)}
              >
                다시 시도
              </Button>
            )}
          </div>
        ) : detail && !detail.available ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-md text-mute-soft">
            <span>landing_visits 캡처 대기 중</span>
            <span className="text-xs-soft">
              마이그레이션 적용 후 방문 데이터가 쌓이면 표시됩니다.
            </span>
          </div>
        ) : detail ? (
          <>
            <DetailSummary detail={detail} />
            {detail.rows.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-md text-mute-soft">
                이 날짜에 기록된 방문이 없습니다.
              </div>
            ) : (
              <ul className="space-y-2">
                {detail.rows.map((r, i) => (
                  <VisitRow key={`${r.createdAt}-${r.sessionId ?? 'anon'}-${i}`} row={r} />
                ))}
              </ul>
            )}
            <p className="border-t border-line-soft pt-3 text-xs-soft leading-[1.6] text-mute-soft">
              raw IP·기기(user-agent)는 프라이버시 설계상 노출하지 않습니다 —
              방문 위치는 국가 단위(country)로만 수집됩니다.
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ── summary header ──────────────────────────────────────────────────────
function DetailSummary({ detail }: { detail: LandingVisitDetail }) {
  return (
    <section className="space-y-3 border-b border-line pb-4">
      <div className="flex items-baseline gap-2 text-md">
        <span className="font-semibold tabular-nums text-ink">
          {detail.total.toLocaleString()}
        </span>
        <span className="text-mute">건 방문</span>
        {detail.capped && (
          <span className="text-xs-soft text-warning">
            · 최근 {detail.total.toLocaleString()}건만 표시(초과분 생략)
          </span>
        )}
      </div>
      {detail.topCountries.length > 0 && (
        <SummaryRow label="국가" items={detail.topCountries} />
      )}
      {detail.topSources.length > 0 && (
        <SummaryRow label="유입" items={detail.topSources} />
      )}
    </section>
  );
}

function SummaryRow({
  label,
  items,
}: {
  label: string;
  items: { label: string; count: number }[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item.label} variant="subtle" size="sm">
            {item.label} · {item.count.toLocaleString()}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ── one visit row ─────────────────────────────────────────────────────────
function VisitRow({ row }: { row: LandingVisitRow }) {
  const utms: { key: string; label: string; value: string }[] = [
    { key: 'source', label: 'source', value: row.utmSource ?? '' },
    { key: 'medium', label: 'medium', value: row.utmMedium ?? '' },
    { key: 'campaign', label: 'campaign', value: row.utmCampaign ?? '' },
    { key: 'term', label: 'term', value: row.utmTerm ?? '' },
    { key: 'content', label: 'content', value: row.utmContent ?? '' },
  ].filter((u) => u.value);

  return (
    <li className="border border-line-soft bg-paper-soft px-3 py-2.5 rounded-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="tabular-nums text-md text-ink">{fmtTime(row.createdAt)}</span>
        <span className="shrink-0 text-xs-soft tabular-nums text-mute">
          {row.country ?? '—'}
        </span>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs-soft">
        <Field label="유입" value={sourceText(row)} />
        <Field label="경로" value={row.path ?? '—'} mono />
        {utms.length > 0 && (
          <>
            <dt className="text-mute-soft">UTM</dt>
            <dd className="flex flex-wrap gap-1">
              {utms.map((u) => (
                <Badge key={u.key} variant="neutral" size="sm">
                  {u.label}: {u.value}
                </Badge>
              ))}
            </dd>
          </>
        )}
        <Field label="세션" value={row.sessionId ?? '—'} mono truncate />
      </dl>
    </li>
  );
}

function Field({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <>
      <dt className="text-mute-soft">{label}</dt>
      <dd
        className={[
          'min-w-0 text-mute',
          mono ? 'font-mono tabular-nums' : '',
          truncate ? 'truncate' : 'break-words',
        ].join(' ')}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </>
  );
}

// Referrer display: host (with full referrer as a hover title) or 직접(=no
// referrer). Mirrors the aggregate 유입 소스 card's direct/referral wording.
function sourceText(row: LandingVisitRow): string {
  if (row.referrerHost) return row.referrerHost;
  if (row.utmSource) return row.utmSource;
  return '직접';
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
