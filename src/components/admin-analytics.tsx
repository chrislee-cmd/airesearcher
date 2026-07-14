'use client';

/* ────────────────────────────────────────────────────────────────────
   Native behavioural analytics dashboard (Track A) — super-admin only.

   Renders the pre-aggregated report from /api/admin/analytics. Two tabs:
   "네이티브" (this DB-backed shell) and "PostHog" (the existing embed,
   shown only when POSTHOG_EMBED_URL is set — #118 joins here later).

   카드 렌더는 analytics-widgets.tsx 로 추출됨(위젯 보드와 공유). 이 컴포넌트는
   탭·기간/필터 컨트롤·refetch·가입 계정 로스터(super-admin 전용)만 소유한다.
   모든 수치는 서버 집계 count — raw row/PII 는 절대 보지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminAnalyticsReport,
  AnalyticsPeriod,
  SignupRoster,
} from '@/lib/admin/analytics';
import {
  ActivityCard,
  Card,
  CumulativeTotalsCard,
  FeatureUsageCard,
  FunnelCard,
  LandingSourceCard,
  LandingTrafficCard,
  RetentionFunnelCard,
  WidgetHealthCard,
} from './analytics-widgets';
import { ChromeButton } from './ui/chrome-button';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Input } from './ui/input';

type Tab = 'native' | 'posthog';

// Shared with LandingBeacon (landing-beacon.tsx). When this localStorage flag
// is 'true' the beacon suppresses its POST, so the super-admin's own landing
// visits (incognito / logged-out / other browsers) stay out of the count.
const SKIP_BEACON_KEY = 'rc_landing_skip_beacon';

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'all', label: '전체' },
];

type Props = {
  initialReport: AdminAnalyticsReport;
  initialSignups: SignupRoster;
  embedUrl: string | null;
  // Read-only public mode (the /status token-gated wall monitor). When true:
  // the signup roster (PII) is not rendered, the period/internal controls are
  // hidden, and the client refetch (which hits the super-admin-gated API) is
  // skipped — the server-provided initialReport is shown as a static snapshot.
  // Default false → the super-admin /admin/analytics view is 100% unchanged.
  publicView?: boolean;
};

export function AdminAnalytics({
  initialReport,
  initialSignups,
  embedUrl,
  publicView = false,
}: Props) {
  const [tab, setTab] = useState<Tab>('native');
  const [report, setReport] = useState(initialReport);
  const [period, setPeriod] = useState<AnalyticsPeriod>(initialReport.period);
  const [excludeInternal, setExcludeInternal] = useState(
    initialReport.excludeInternal,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: AnalyticsPeriod, exclude: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          period: p,
          excludeInternal: String(exclude),
        });
        const res = await fetch(`/api/admin/analytics?${qs}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setReport((await res.json()) as AdminAnalyticsReport);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Refetch when filters change (skip the very first render — the server
  // already gave us a matching report).
  const firstRender = useRef(true);
  useEffect(() => {
    // Public read-only view never refetches — the gated /api/admin/analytics
    // would 404 for anonymous visitors, and the controls that drive this are
    // hidden anyway. Stay on the server-provided static snapshot.
    if (publicView) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load(period, excludeInternal);
  }, [period, excludeInternal, load, publicView]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            ADMIN · 행동 분석
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.01em] text-ink">
            네이티브 행동 대시보드
          </h1>
          <p className="mt-1 text-md text-mute">
            credit_transactions · job status · 인터뷰 퍼널 · 로그인 —
            신규 계측 없이 집계
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ChromeButton
            variant={tab === 'native' ? 'primary' : 'default'}
            size="sm"
            uppercase
            onClick={() => setTab('native')}
          >
            네이티브
          </ChromeButton>
          {embedUrl && (
            <ChromeButton
              variant={tab === 'posthog' ? 'primary' : 'default'}
              size="sm"
              uppercase
              onClick={() => setTab('posthog')}
            >
              PostHog
            </ChromeButton>
          )}
        </div>
      </header>

      {tab === 'posthog' && embedUrl ? (
        <iframe
          src={embedUrl}
          className="h-[70vh] w-full border border-line rounded-sm"
          title="PostHog Analytics"
          allow="clipboard-write"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!publicView && (
              <div className="flex items-center gap-1">
                {PERIODS.map((p) => (
                  <ChromeButton
                    key={p.key}
                    variant={period === p.key ? 'primary' : 'default'}
                    size="sm"
                    disabled={loading}
                    onClick={() => setPeriod(p.key)}
                  >
                    {p.label}
                  </ChromeButton>
                ))}
              </div>
            )}
            <div className="ml-auto flex items-center gap-3">
              {!publicView && (
                <label className="flex cursor-pointer items-center gap-2 text-md text-mute">
                  <Checkbox
                    checked={excludeInternal}
                    disabled={loading}
                    onChange={(e) => setExcludeInternal(e.target.checked)}
                  />
                  내부계정 제외
                  <span className="text-xs-soft text-mute-soft tabular-nums">
                    ({report.internalAccountCount})
                  </span>
                </label>
              )}
              <span className="text-xs-soft tabular-nums text-mute-soft">
                {new Date(report.generatedAt).toLocaleString('ko-KR')}
              </span>
            </div>
          </div>

          {error && (
            <div className="border border-warning/40 bg-warning/5 px-3 py-2 text-md text-warning rounded-sm">
              {error}
            </div>
          )}

          <CumulativeTotalsCard report={report} />
          <ActivityCard report={report} />
          <FeatureUsageCard rows={report.featureUsage} />
          <WidgetHealthCard rows={report.widgetHealth} />
          <FunnelCard stages={report.interviewFunnel} />

          <div className="pt-2 text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            랜딩 트래픽 · #574 landing_visits
          </div>
          {!publicView && <LandingSelfVisitToggle />}
          <LandingTrafficCard landing={report.landing} />
          <LandingSourceCard landing={report.landing} />
          <RetentionFunnelCard landing={report.landing} />

          {!publicView && <SignupAccountsCard roster={initialSignups} />}
        </>
      )}
    </div>
  );
}

// Self-visit opt-out toggle. Writes the localStorage flag that LandingBeacon
// reads to suppress its /api/track/landing POST — keeps the super-admin's own
// landing visits (incognito / logged-out / other browsers) out of the count.
// Per-browser by nature: the flag lives in this browser's localStorage, so
// each browser / incognito window must be toggled independently. Admin-only
// (rendered only in the super-admin /admin/analytics view, never in /status).
function LandingSelfVisitToggle() {
  // SSR renders unchecked (skip=false) so server/client markup matches; the
  // real flag is read from localStorage post-hydration below.
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    // localStorage is client-only, so the checked state must be synced in from
    // external storage after hydration — the legitimate case the
    // set-state-in-effect rule allows.
    let stored = false;
    try {
      stored = localStorage.getItem(SKIP_BEACON_KEY) === 'true';
    } catch {
      // private mode / storage disabled — leave unchecked
    }
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration external-storage probe (see comment above)
      setSkip(true);
    }
  }, []);

  const toggle = (next: boolean) => {
    setSkip(next);
    try {
      if (next) localStorage.setItem(SKIP_BEACON_KEY, 'true');
      else localStorage.removeItem(SKIP_BEACON_KEY);
    } catch {
      // private mode — best-effort, UI already reflects intent
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex cursor-pointer items-center gap-2 text-md text-mute">
        <Checkbox
          checked={skip}
          onChange={(e) => toggle(e.target.checked)}
        />
        이 브라우저에서 랜딩 추적 안 하기
      </label>
      {skip && (
        <span className="text-xs-soft tabular-nums text-amore">
          이후 방문부터 반영
        </span>
      )}
      <span className="text-xs-soft text-mute-soft">
        다른 브라우저·시크릿 창에서는 각각 설정해야 합니다
      </span>
    </div>
  );
}

// YYYY-MM-DD HH:mm in Asia/Seoul — compact, operator-clock aligned.
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Signup roster — full census of auth.users. Filter-independent (전수);
// internal/super accounts are badged, never dropped. Optional email
// substring search narrows a long roster client-side. Admin-only (never
// rendered in the public /status view).
function SignupAccountsCard({ roster }: { roster: SignupRoster }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster.accounts;
    return roster.accounts.filter((a) => a.email.toLowerCase().includes(q));
  }, [query, roster.accounts]);

  return (
    <Card
      title="가입 계정"
      hint="auth.users 전수 — 기간/필터 무관. 내부·운영 계정은 뱃지 표기"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-md text-mute">
          총{' '}
          <span className="font-semibold tabular-nums text-ink">
            {roster.total.toLocaleString()}
          </span>
          명
          {query.trim() && (
            <span className="text-xs-soft text-mute-soft">
              {' '}
              · {filtered.length.toLocaleString()}건 표시
            </span>
          )}
        </span>
        <div className="w-full sm:w-64">
          <Input
            size="sm"
            placeholder="이메일 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {roster.total === 0 ? (
        <div className="flex h-32 items-center justify-center text-md text-mute-soft">
          가입 계정이 없습니다.
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-md text-mute-soft">
          검색 결과가 없습니다.
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-sm border border-line-soft">
          <table className="w-full text-md">
            <thead className="sticky top-0 bg-paper-soft">
              <tr className="border-b border-line-soft text-left">
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
                  이메일
                </th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
                  provider
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
                  가입일
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.14em] text-mute-soft">
                  최근 로그인
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => (
                <tr
                  key={`${a.email}-${a.createdAt}-${i}`}
                  className="border-b border-line-soft last:border-b-0"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-ink">{a.email}</span>
                      {a.isInternal && (
                        <Badge variant="subtle" size="sm">
                          내부
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-mute">{a.provider ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-mute">
                    {fmtDateTime(a.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-mute">
                    {fmtDateTime(a.lastSignInAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
