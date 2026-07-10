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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  ReasonSegment,
} from '@/lib/admin/analytics';
import { ChromeButton } from './ui/chrome-button';
import { Checkbox } from './ui/checkbox';

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

type Props = {
  initialReport: AdminAnalyticsReport;
  embedUrl: string | null;
};

export function AdminAnalytics({ initialReport, embedUrl }: Props) {
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
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load(period, excludeInternal);
  }, [period, excludeInternal, load]);

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
            <div className="flex items-center gap-3">
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

          <ActivityCard report={report} />
          <FeatureUsageCard rows={report.featureUsage} />
          <WidgetHealthCard rows={report.widgetHealth} />
          <FunnelCard stages={report.interviewFunnel} />
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

function EmptyChart() {
  return (
    <div className="flex h-32 items-center justify-center text-md text-mute-soft">
      선택한 기간·필터에 데이터가 없습니다.
    </div>
  );
}
