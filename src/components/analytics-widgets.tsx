'use client';

/* ────────────────────────────────────────────────────────────────────
   Analytics 위젯 카드 — 렌더 SSOT.

   admin-analytics.tsx 에 있던 카드 렌더를 개별 컴포넌트로 추출한 것. 두 소비처가
   공유한다:
     1. <AdminAnalytics> (/admin/analytics) — 기존 세로 스택 (렌더 동일, 회귀 없음).
     2. <StatusWidgetBoard> (/status) — WIDGET_REGISTRY 를 통해 위젯을 배치.

   각 카드는 오직 report(또는 그 slice)만 받아 count 를 그린다 — 여기서도 raw row/
   PII 는 절대 보지 않는다. 차트 팔레트는 topline-blocks 의 recharts + 디자인 토큰.
   ──────────────────────────────────────────────────────────────────── */

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
import type { MouseHandlerDataParam } from 'recharts';
import type {
  AdminAnalyticsReport,
  FeatureUsageRow,
  LandingTraffic,
  ReasonSegment,
  SourceBucketKey,
} from '@/lib/admin/analytics';
import type { WidgetId } from '@/lib/admin/dashboard-layout';

// reason segment → { label, color }. topline-blocks 팔레트(디자인 토큰 + 2 액센트).
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

// KRW currency — "₩200,000". No decimals (won has no minor unit in practice).
const krwFormat = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

export function Card({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  // 위젯 헤더 우측 슬롯(편집 모드의 제거/리사이즈 컨트롤 등). 없으면 미렌더.
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col border border-line bg-paper px-5 py-4 rounded-sm">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-[-0.005em] text-ink">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-xs-soft text-mute-soft">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
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

export function EmptyChart() {
  return (
    <div className="flex h-32 items-center justify-center text-md text-mute-soft">
      선택한 기간·필터에 데이터가 없습니다.
    </div>
  );
}

// #583 — cumulative headline totals: 전수 signup count + paid-revenue sum.
// admin-analytics 세로 스택은 두 stat 을 한 카드에 묶어 쓴다(기존 렌더 유지).
// 위젯 보드는 아래 CumulativeUsersCard / RevenueCard 로 쪼개 쓴다.
export function CumulativeTotalsCard({
  report,
}: {
  report: AdminAnalyticsReport;
}) {
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

// 위젯 보드용 — 누적 가입 유저 단독(span 1 에 어울리는 작은 stat 위젯).
// ⚠️ 매출/가입 누적은 토큰 URL 로 공개됨 — 토큰 게이트가 유일 방어(사용자 명시).
export function CumulativeUsersCard({
  report,
}: {
  report: AdminAnalyticsReport;
}) {
  return (
    <Card title="누적 가입 유저" hint="가입 전수 — 기간·필터 무관">
      <Stat
        label="누적 가입 유저"
        value={`${report.totals.users.toLocaleString()}명`}
      />
    </Card>
  );
}

// 위젯 보드용 — 누적 결제금액 단독.
export function RevenueCard({ report }: { report: AdminAnalyticsReport }) {
  return (
    <Card title="누적 결제금액" hint="결제 완료(paid) 누적 — 환불/취소 제외">
      <Stat
        label="누적 결제금액"
        value={krwFormat.format(report.totals.revenueKrwPaid)}
      />
    </Card>
  );
}

// A — DAU/WAU trend.
export function ActivityCard({ report }: { report: AdminAnalyticsReport }) {
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
export function FeatureUsageCard({ rows }: { rows: FeatureUsageRow[] }) {
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
export function WidgetHealthCard({
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
export function FunnelCard({
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

// Shown inside a landing card when landing_visits isn't reachable yet.
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
// #499 — onSelectDay 가 주어지면 막대 클릭 시 그 날짜(Asia/Seoul YYYY-MM-DD)로
// 개별 방문 상세를 연다. 슈퍼어드민 대시보드만 이 prop 을 넘긴다 —
// 공개 /status 위젯 보드는 넘기지 않아 클릭 비활성(상세 API 는 어드민 게이트).
export function LandingTrafficCard({
  landing,
  onSelectDay,
}: {
  landing: LandingTraffic;
  onSelectDay?: (day: string) => void;
}) {
  const hasData = landing.trend.some((p) => p.newVisitors + p.returning > 0);
  const clickable = Boolean(onSelectDay);
  // recharts 차트 클릭 → activeIndex 로 트렌드 배열을 참조해 그 포인트의 full
  // day(YYYY-MM-DD)를 읽는다. index 기반이라 name(MM-DD)의 연말 중복과 무관.
  const handleChartClick = (state: MouseHandlerDataParam) => {
    const idx =
      typeof state?.activeIndex === 'number'
        ? state.activeIndex
        : Number(state?.activeIndex);
    if (!Number.isInteger(idx)) return;
    const day = landing.trend[idx]?.day;
    if (day && onSelectDay) onSelectDay(day);
  };
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
              <div className="mb-2 flex flex-wrap items-center gap-3">
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
                {clickable && (
                  <span className="ml-auto text-xs-soft text-mute-soft">
                    막대 클릭 → 그날 방문 상세
                  </span>
                )}
              </div>
              <div className={`h-64 w-full ${clickable ? 'cursor-pointer' : ''}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={landing.trend}
                    onClick={clickable ? handleChartClick : undefined}
                  >
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
export function LandingSourceCard({ landing }: { landing: LandingTraffic }) {
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
export function RetentionFunnelCard({ landing }: { landing: LandingTraffic }) {
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

/* ── 위젯 레지스트리 ──────────────────────────────────────────────────────
   위젯 id → { 라벨, report 를 카드로 렌더 }. 위젯 보드(StatusWidgetBoard)와
   "+ 위젯 추가" 팔레트가 이 한 곳을 SSOT 로 참조한다. 새 위젯을 추가하면
   dashboard-layout.ts 의 WIDGET_IDS + 여기 두 곳만 갱신. ──────────────────── */

export type WidgetDef = {
  id: WidgetId;
  label: string;
  render: (report: AdminAnalyticsReport) => React.ReactNode;
};

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDef> = {
  dau_wau: {
    id: 'dau_wau',
    label: 'DAU / WAU 추이',
    render: (r) => <ActivityCard report={r} />,
  },
  cumulative_users: {
    id: 'cumulative_users',
    label: '누적 가입 유저',
    render: (r) => <CumulativeUsersCard report={r} />,
  },
  revenue: {
    id: 'revenue',
    label: '누적 결제금액',
    render: (r) => <RevenueCard report={r} />,
  },
  feature_usage: {
    id: 'feature_usage',
    label: '기능별 사용량',
    render: (r) => <FeatureUsageCard rows={r.featureUsage} />,
  },
  widget_health: {
    id: 'widget_health',
    label: '위젯 성공 / 실패율',
    render: (r) => <WidgetHealthCard rows={r.widgetHealth} />,
  },
  funnel: {
    id: 'funnel',
    label: '인터뷰 추가질문 퍼널',
    render: (r) => <FunnelCard stages={r.interviewFunnel} />,
  },
  landing_traffic: {
    id: 'landing_traffic',
    label: '랜딩 접속자 추이',
    render: (r) => <LandingTrafficCard landing={r.landing} />,
  },
  landing_source: {
    id: 'landing_source',
    label: '랜딩 유입 소스',
    render: (r) => <LandingSourceCard landing={r.landing} />,
  },
  landing_retention: {
    id: 'landing_retention',
    label: '랜딩 → 활성 리텐션 퍼널',
    render: (r) => <RetentionFunnelCard landing={r.landing} />,
  },
};
