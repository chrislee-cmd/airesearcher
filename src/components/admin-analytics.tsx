'use client';

/* ────────────────────────────────────────────────────────────────────
   Native behavioural analytics dashboard (Track A) — super-admin only.

   Renders the pre-aggregated report from /api/admin/analytics. Two tabs:
   "네이티브" (this DB-backed shell) and "PostHog" (the existing embed,
   shown only when POSTHOG_EMBED_URL is set — #118 joins here later).

   All figures are counts computed server-side; this component never sees
   raw rows or PII. Charts reuse the recharts + design-token palette
   already established in interviews-v2/topline-blocks.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AdminAnalyticsReport,
  AnalyticsPeriod,
  FeatureUsageRow,
  LandingTraffic,
  ReasonSegment,
  SignupRoster,
  SourceBucketKey,
} from '@/lib/admin/analytics';
import { ChromeButton } from './ui/chrome-button';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Input } from './ui/input';

type Tab = 'native' | 'posthog';

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'all', label: '전체' },
];

// reason segment → { label, color }. Colours follow the topline-blocks
// palette (design tokens + two accents) so the stack reads consistently.
const REASON_META: Record<ReasonSegment, { label: string; color: string }> = {
  feature_use: { label: '유료', color: 'var(--color-amore)' },
  trial_use: { label: '체험', color: '#f97316' },
  unlimited_use: { label: '내부/무제한', color: 'var(--color-mute)' },
  feature_refund: { label: '환불', color: '#a855f7' },
  other: { label: '기타', color: 'var(--color-line)' },
};
const REASON_ORDER: ReasonSegment[] = [
  'feature_use',
  'trial_use',
  'unlimited_use',
  'feature_refund',
  'other',
];

// Landing source buckets → { label, color }. Same topline palette as the
// reason stack so the two dashboards read consistently.
const SOURCE_META: Record<SourceBucketKey, { label: string; color: string }> = {
  direct: { label: '직접', color: 'var(--color-mute)' },
  organic: { label: '검색(오가닉)', color: 'var(--color-amore)' },
  referral: { label: '리퍼럴', color: '#f97316' },
  campaign: { label: '캠페인', color: '#a855f7' },
};
const SOURCE_ORDER: SourceBucketKey[] = [
  'direct',
  'organic',
  'referral',
  'campaign',
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
          <LandingTrafficCard landing={report.landing} />
          <LandingSourceCard landing={report.landing} />
          <RetentionFunnelCard landing={report.landing} />

          {!publicView && <SignupAccountsCard roster={initialSignups} />}
        </>
      )}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-paper px-5 py-4 rounded-sm">
      <header className="mb-3">
        <h2 className="text-xl font-semibold tracking-[-0.005em] text-ink">
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-xs-soft text-mute-soft">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line-soft bg-paper-soft px-4 py-3 rounded-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums tracking-[-0.01em] text-ink">
        {value}
      </div>
    </div>
  );
}

// KRW currency — "₩200,000". No decimals (won has no minor unit in practice).
const krwFormat = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

// #583 — cumulative headline totals: 전수 signup count + paid-revenue sum.
// Period/filter-independent, so it renders identically in every view. Shown
// in the public /status wall too (both figures are aggregates, not PII).
// ⚠️ 누적 결제금액(매출)이 토큰 URL 로 공개됨 — 토큰 게이트가 유일 방어(사용자 명시 요청).
function CumulativeTotalsCard({ report }: { report: AdminAnalyticsReport }) {
  const { totals } = report;
  return (
    <Card
      title="누적 지표"
      hint="가입 유저 전수 · 결제 완료(paid) 금액 누적 — 기간·필터 무관, 환불/취소 제외"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="누적 가입 유저"
          value={`${totals.users.toLocaleString()}명`}
        />
        <Stat
          label="누적 결제금액"
          value={krwFormat.format(totals.revenueKrwPaid)}
        />
      </div>
    </Card>
  );
}

// A — DAU/WAU trend.
function ActivityCard({ report }: { report: AdminAnalyticsReport }) {
  const { activity } = report;
  const hasData = activity.trend.some((p) => p.value > 0);
  return (
    <Card
      title="DAU / WAU 추이"
      hint="audit_log login_success 기준 일별 고유 로그인 사용자"
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="오늘 DAU" value={activity.dauToday.toLocaleString()} />
        <Stat label="최근 7일 WAU" value={activity.wau7d.toLocaleString()} />
        <Stat
          label="기간 고유 사용자"
          value={activity.periodDistinctUsers.toLocaleString()}
        />
      </div>
      {hasData ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activity.trend}>
              <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="value"
                name="고유 로그인"
                stroke="var(--color-amore)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

// B — feature usage stacked by reason segment.
function FeatureUsageCard({ rows }: { rows: FeatureUsageRow[] }) {
  const data = rows.map((r) => ({
    name: r.feature,
    ...r.byReason,
  }));
  return (
    <Card
      title="기능별 사용량"
      hint="credit_transactions — reason 세그먼트(유료/체험/내부/환불) 스택"
    >
      {rows.length > 0 ? (
        <>
          <div className="mb-2 flex flex-wrap gap-3">
            {REASON_ORDER.map((seg) => (
              <span key={seg} className="flex items-center gap-1.5 text-xs-soft text-mute">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-xs"
                  style={{ background: REASON_META[seg].color }}
                />
                {REASON_META[seg].label}
              </span>
            ))}
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={40} />
                <Tooltip />
                {REASON_ORDER.map((seg) => (
                  <Bar
                    key={seg}
                    dataKey={seg}
                    name={REASON_META[seg].label}
                    stackId="usage"
                    fill={REASON_META[seg].color}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

// C — widget success / fail from job-status tables.
function WidgetHealthCard({
  rows,
}: {
  rows: AdminAnalyticsReport['widgetHealth'];
}) {
  const any = rows.some((r) => r.total > 0);
  return (
    <Card
      title="위젯 성공 / 실패율"
      hint="job status 분포 — 성공 / 실패 / 진행·기타"
    >
      {any ? (
        <div className="space-y-2">
          {rows.map((r) => {
            const done = r.success + r.fail;
            const okPct = r.total > 0 ? (r.success / r.total) * 100 : 0;
            const failPct = r.total > 0 ? (r.fail / r.total) * 100 : 0;
            const otherPct = Math.max(0, 100 - okPct - failPct);
            return (
              <div key={r.widget}>
                <div className="mb-1 flex items-baseline justify-between text-md">
                  <span className="font-semibold text-ink-2">{r.label}</span>
                  <span className="text-xs-soft tabular-nums text-mute-soft">
                    총 {r.total.toLocaleString()} · 성공 {r.success} · 실패{' '}
                    {r.fail}
                    {r.errorRate !== null && (
                      <span className="text-warning">
                        {' '}
                        · 에러율 {(r.errorRate * 100).toFixed(1)}%
                      </span>
                    )}
                    {done === 0 && ' · 종료 잡 없음'}
                  </span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line-soft">
                  <span
                    className="h-full bg-amore"
                    style={{ width: `${okPct}%` }}
                  />
                  <span
                    className="h-full bg-warning"
                    style={{ width: `${failPct}%` }}
                  />
                  <span
                    className="h-full bg-mute-soft/40"
                    style={{ width: `${otherPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

// D — interview funnel: 생성 → 분석 완료 → 추가 질문.
function FunnelCard({
  stages,
}: {
  stages: AdminAnalyticsReport['interviewFunnel'];
}) {
  const max = Math.max(1, ...stages.map((s) => s.rows));
  const any = stages.some((s) => s.rows > 0);
  return (
    <Card
      title="인터뷰 추가질문 퍼널"
      hint="interview_projects → interview_jobs(done) → interview_search_queries"
    >
      {any ? (
        <div className="space-y-3">
          {stages.map((s) => (
            <div key={s.stage}>
              <div className="mb-1 flex items-baseline justify-between text-md">
                <span className="font-semibold text-ink-2">{s.label}</span>
                <span className="text-xs-soft tabular-nums text-mute-soft">
                  {s.rows.toLocaleString()}건 · 고유 사용자 {s.users}
                  {s.conversion !== null && (
                    <span className="text-amore">
                      {' '}
                      · 전환 {(s.conversion * 100).toFixed(0)}%
                    </span>
                  )}
                </span>
              </div>
              <div className="h-6 w-full rounded-sm bg-line-soft">
                <div
                  className="flex h-full min-w-[2%] items-center justify-end rounded-sm bg-amore px-2 text-xs font-semibold tabular-nums text-paper"
                  style={{ width: `${(s.rows / max) * 100}%` }}
                >
                  {s.rows}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

// Shown inside a landing card when landing_visits isn't reachable yet
// (migration not applied on this env → capture 대기).
function LandingUnavailable() {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-md text-mute-soft">
      <span>landing_visits 캡처 대기 중</span>
      <span className="text-xs-soft">
        마이그레이션 적용 후 방문 데이터가 쌓이면 표시됩니다.
      </span>
    </div>
  );
}

// #575-1 — 랜딩 접속자 추이: 일별 고유 세션, 신규 vs 재방문 스택.
function LandingTrafficCard({ landing }: { landing: LandingTraffic }) {
  const hasData = landing.trend.some((p) => p.newVisitors + p.returning > 0);
  return (
    <Card
      title="랜딩 접속자 추이"
      hint="landing_visits 고유 session_id — 익명 전수(내부계정 제외 미적용). 신규=최초 방문일, 재방문=이전 방문 이력"
    >
      {!landing.available ? (
        <LandingUnavailable />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="기간 방문자"
              value={landing.periodVisitors.toLocaleString()}
            />
            <Stat
              label="신규 방문자"
              value={landing.periodNewVisitors.toLocaleString()}
            />
            <Stat
              label="재방문자"
              value={landing.periodReturning.toLocaleString()}
            />
          </div>
          {hasData ? (
            <>
              <div className="mb-2 flex flex-wrap gap-3">
                <span className="flex items-center gap-1.5 text-xs-soft text-mute">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-xs"
                    style={{ background: 'var(--color-amore)' }}
                  />
                  신규
                </span>
                <span className="flex items-center gap-1.5 text-xs-soft text-mute">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-xs"
                    style={{ background: 'var(--color-mute)' }}
                  />
                  재방문
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={landing.trend}>
                    <CartesianGrid
                      stroke="var(--color-line-soft)"
                      vertical={false}
                    />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 12 }}
                      width={32}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="newVisitors"
                      name="신규"
                      stackId="visits"
                      fill="var(--color-amore)"
                    />
                    <Bar
                      dataKey="returning"
                      name="재방문"
                      stackId="visits"
                      fill="var(--color-mute)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <EmptyChart />
          )}
        </>
      )}
    </Card>
  );
}

// #575-2 — 유입 소스: referrer_host + utm_source 를 4버킷으로 그룹 + top-N.
function LandingSourceCard({ landing }: { landing: LandingTraffic }) {
  const { totalVisits, buckets } = landing.sources;
  const ordered = SOURCE_ORDER.map(
    (key) => buckets.find((b) => b.bucket === key),
  ).filter((b): b is NonNullable<typeof b> => Boolean(b));
  return (
    <Card
      title="랜딩 유입 소스"
      hint="referrer_host + utm_source → 직접 / 검색(오가닉) / 리퍼럴 / 캠페인 버킷. 버킷 합 = 총 방문"
    >
      {!landing.available ? (
        <LandingUnavailable />
      ) : totalVisits > 0 ? (
        <div className="space-y-3">
          <div className="text-xs-soft tabular-nums text-mute-soft">
            총 방문 {totalVisits.toLocaleString()}
          </div>
          {ordered.map((b) => {
            const pct = totalVisits > 0 ? (b.total / totalVisits) * 100 : 0;
            const meta = SOURCE_META[b.bucket];
            return (
              <div key={b.bucket}>
                <div className="mb-1 flex items-baseline justify-between text-md">
                  <span className="flex items-center gap-1.5 font-semibold text-ink-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-xs"
                      style={{ background: meta.color }}
                    />
                    {meta.label}
                  </span>
                  <span className="text-xs-soft tabular-nums text-mute-soft">
                    {b.total.toLocaleString()}건 · {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-line-soft">
                  <span
                    className="block h-full"
                    style={{ width: `${pct}%`, background: meta.color }}
                  />
                </div>
                {b.top.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs-soft text-mute-soft">
                    {b.top.map((item) => (
                      <span key={item.label} className="tabular-nums">
                        {item.label}{' '}
                        <span className="text-mute">
                          {item.count.toLocaleString()}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyChart />
      )}
    </Card>
  );
}

// #575-3 — 리텐션 퍼널: 방문 → 가입 → 활성. 집계 기준(코호트 아님).
function RetentionFunnelCard({ landing }: { landing: LandingTraffic }) {
  const stages = landing.retention;
  const max = Math.max(1, ...stages.map((s) => s.count));
  const any = stages.some((s) => s.count > 0);
  return (
    <Card
      title="랜딩 → 활성 리텐션 퍼널"
      hint="방문(landing_visits 세션) → 가입(profiles) → 활성(credit_transactions 첫 사용). 가입·활성 단계만 내부계정 제외 적용"
    >
      {!landing.available ? (
        <LandingUnavailable />
      ) : (
        <>
          <div className="mb-3 border border-line-soft bg-paper-soft px-3 py-2 text-xs-soft text-mute rounded-sm">
            ⚠️ 집계 기준(코호트 아님) — 익명 session_id(방문)와 식별된
            사용자(가입·활성)는 직접 조인이 불가하여, 전환율은 단계별 집계
            비율입니다(per-visitor 코호트 추적 아님).
          </div>
          {any ? (
            <div className="space-y-3">
              {stages.map((s) => (
                <div key={s.stage}>
                  <div className="mb-1 flex items-baseline justify-between text-md">
                    <span className="font-semibold text-ink-2">{s.label}</span>
                    <span className="text-xs-soft tabular-nums text-mute-soft">
                      {s.count.toLocaleString()}
                      {s.conversion !== null && (
                        <span className="text-amore">
                          {' '}
                          · 전환 {(s.conversion * 100).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-6 w-full rounded-sm bg-line-soft">
                    <div
                      className="flex h-full min-w-[2%] items-center justify-end rounded-sm bg-amore px-2 text-xs font-semibold tabular-nums text-paper"
                      style={{ width: `${(s.count / max) * 100}%` }}
                    >
                      {s.count.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyChart />
          )}
        </>
      )}
    </Card>
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
// substring search narrows a long roster client-side.
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

function EmptyChart() {
  return (
    <div className="flex h-32 items-center justify-center text-md text-mute-soft">
      선택한 기간·필터에 데이터가 없습니다.
    </div>
  );
}
