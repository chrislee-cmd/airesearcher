import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail, superAdminEmails } from './superadmin';

/* ────────────────────────────────────────────────────────────────────
   Native behavioural analytics aggregator (Track A).

   Runs server-only with the service-role client and returns *only*
   pre-aggregated counts — never raw rows or PII. The dashboard is built
   from data that already exists today (zero new instrumentation):

     A. DAU/WAU        — audit_log `login_success` distinct users
     B. feature usage  — credit_transactions by feature × reason segment
     C. widget health  — job-status tables (success / fail / other)
     D. interview funnel — projects → jobs(done) → search_queries

   "Internal account" pollution (super-admin, unlimited orgs, QA testers)
   is excluded by default via a user_id blocklist resolved server-side.
   ──────────────────────────────────────────────────────────────────── */

export type AnalyticsPeriod = '7d' | '30d' | 'all';

export type AdminAnalyticsQuery = {
  period: AnalyticsPeriod;
  excludeInternal: boolean;
};

// One point in a daily/weekly time series.
export type SeriesPoint = { name: string; value: number };

// credit_transactions.reason buckets we surface as segments. Anything
// else falls into `other` so a new reason can't silently vanish.
export type ReasonSegment =
  | 'unlimited_use'
  | 'trial_use'
  | 'feature_use'
  | 'feature_refund'
  | 'other';

export type FeatureUsageRow = {
  feature: string;
  total: number;
  byReason: Record<ReasonSegment, number>;
};

export type WidgetHealthRow = {
  widget: string;
  label: string;
  total: number;
  success: number;
  fail: number;
  other: number;
  // Percentage of *terminal* jobs (success + fail) that failed. null when
  // there are no terminal jobs yet (nothing to rate).
  errorRate: number | null;
};

export type FunnelStage = {
  stage: string;
  label: string;
  rows: number; // total rows at this stage
  users: number; // distinct users at this stage
  // Conversion from the previous stage's distinct users (0..1). null on
  // the first stage.
  conversion: number | null;
};

/* ── Landing traffic (card #575) ──────────────────────────────────────────
   Native landing-page traffic surfaced from `landing_visits` (#574). Three
   sub-sections: visitor trend (new vs returning), source breakdown (bucketed
   referrer/utm), and a visit→signup→active retention funnel.

   ⚠️ The funnel is an *aggregate stage count*, NOT a per-visitor cohort:
   anonymous session_ids (landing_visits) can't be joined to identified
   auth.users (signup doesn't stamp the landing session), so the conversions
   are cross-unit ratios (sessions → users). The UI must label this. */

// One day in the visitor trend, split by whether each distinct session is
// making its first-ever appearance (new) or has been seen on an earlier day.
export type LandingTrendPoint = {
  name: string;
  newVisitors: number;
  returning: number;
};

// Referrer/utm buckets. `campaign` wins whenever a utm_source is present
// (paid/campaign attribution); otherwise we classify by referrer host.
export type SourceBucketKey = 'direct' | 'organic' | 'referral' | 'campaign';

export type SourceItem = { label: string; count: number };

export type SourceBucket = {
  bucket: SourceBucketKey;
  total: number;
  top: SourceItem[]; // top-N referrer hosts / utm sources within the bucket
};

export type RetentionStage = {
  stage: 'visit' | 'signup' | 'active';
  label: string;
  count: number;
  // Conversion from the previous stage (0..1). null on the first stage.
  // Cross-unit (sessions → users) — an aggregate ratio, not a cohort rate.
  conversion: number | null;
};

export type LandingTraffic = {
  // Distinct landing sessions over the period. Anonymous → 전수 (the internal
  // account exclusion never applies to the visit stage).
  periodVisitors: number;
  periodNewVisitors: number;
  periodReturning: number;
  trend: LandingTrendPoint[];
  sources: {
    totalVisits: number;
    buckets: SourceBucket[];
  };
  retention: RetentionStage[];
  // False when landing_visits isn't reachable on this env (migration not yet
  // applied) — the UI shows a "capture 대기" hint instead of empty charts.
  available: boolean;
};

// Cumulative, period/filter-independent headline totals (card #583). Both
// are 전수 aggregate figures — a plain signup census and paid-revenue sum —
// so they carry no PII and render in the public /status view too.
export type CumulativeTotals = {
  // Every registered profile (전수) — the internal-account exclusion never
  // applies here (this is the raw "총 가입자 수").
  users: number;
  // Sum of payments.amount_krw where status='paid' (KRW). amount_krw is
  // always stamped in KRW list price even for USD-rail charges, so this is a
  // currency-clean total. Refunded/cancelled/failed and is_test rows are
  // excluded.
  revenueKrwPaid: number;
};

export type AdminAnalyticsReport = {
  generatedAt: string;
  period: AnalyticsPeriod;
  excludeInternal: boolean;
  internalAccountCount: number;
  totals: CumulativeTotals;
  activity: {
    dauToday: number;
    wau7d: number;
    periodDistinctUsers: number;
    trend: SeriesPoint[]; // daily distinct logins
  };
  featureUsage: FeatureUsageRow[];
  widgetHealth: WidgetHealthRow[];
  interviewFunnel: FunnelStage[];
  landing: LandingTraffic;
};

const REASON_SEGMENTS: ReasonSegment[] = [
  'unlimited_use',
  'trial_use',
  'feature_use',
  'feature_refund',
  'other',
];

// Job-status tables and how each status maps to success/fail. Statuses not
// listed are counted as "other" (in-progress / queued / cancelled).
// `statusColumn` overrides the default 'status' column when a table's
// terminal lifecycle lives elsewhere (interview V2 advances index_status,
// not the vestigial 'status' column — see below).
const WIDGET_HEALTH_SOURCES: {
  table: string;
  label: string;
  success: string[];
  fail: string[];
  statusColumn?: string;
}[] = [
  { table: 'desk_jobs', label: '데스크 리서치', success: ['done'], fail: ['error', 'cancelled'] },
  { table: 'insights_jobs', label: '인사이트 분석기', success: ['ready'], fail: ['failed'] },
  { table: 'transcript_jobs', label: '전사록', success: ['done'], fail: ['error'] },
  // OBS-4: interview V2 (use-interview-v2-upload → /interviews/index) drives
  // the batch lifecycle on `index_status` (pending/indexing/done/error) and
  // leaves the legacy `status` column stuck at 'queued' — so counting `status`
  // always yielded terminal=0 (fail=0, errorRate null → 노랑). The failure IS
  // recorded, on index_status='error' (/interviews/index catch). Count that.
  {
    table: 'interview_jobs',
    label: '인터뷰 결과',
    success: ['done'],
    fail: ['error'],
    statusColumn: 'index_status',
  },
  // OBS-4: 'error' is new (migration 20260710155935). Was fail:[] → 노랑.
  { table: 'translate_sessions', label: '동시통역', success: ['ended'], fail: ['error'] },
];

type Db = ReturnType<typeof createAdminClient>;

function reasonSegment(reason: string | null): ReasonSegment {
  if (
    reason === 'unlimited_use' ||
    reason === 'trial_use' ||
    reason === 'feature_use' ||
    reason === 'feature_refund'
  ) {
    return reason;
  }
  return 'other';
}

function periodCutoff(period: AnalyticsPeriod): Date | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// YYYY-MM-DD in Asia/Seoul (the product's home timezone), so day buckets
// line up with what an operator sees on their own clock.
function seoulDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// Resolve the set of user_ids we treat as "internal": super-admin emails,
// members/owners of unlimited orgs, and QA testers. Best-effort — any
// individual lookup failing just narrows the blocklist rather than 500-ing.
async function internalUserIds(db: Db): Promise<Set<string>> {
  const ids = new Set<string>();

  const [saProfiles, unlimitedOrgs, qaTesters] = await Promise.all([
    db.from('profiles').select('id').in('email', superAdminEmails()),
    db.from('organizations').select('id, owner_id').eq('is_unlimited', true),
    db.from('profiles').select('id').eq('is_qa_tester', true),
  ]);

  for (const p of saProfiles.data ?? []) if (p.id) ids.add(p.id as string);
  for (const p of qaTesters.data ?? []) if (p.id) ids.add(p.id as string);

  const orgIds: string[] = [];
  for (const o of unlimitedOrgs.data ?? []) {
    if (o.id) orgIds.push(o.id as string);
    if (o.owner_id) ids.add(o.owner_id as string);
  }
  if (orgIds.length > 0) {
    const members = await db
      .from('organization_members')
      .select('user_id')
      .in('org_id', orgIds);
    for (const m of members.data ?? [])
      if (m.user_id) ids.add(m.user_id as string);
  }

  return ids;
}

// Generic time-windowed fetch of minimal columns for one table. Rows never
// leave the server — callers reduce them to counts. Bounded by a generous
// cap so a runaway table can't blow up memory (logged as a soft ceiling).
async function fetchRows(
  db: Db,
  table: string,
  columns: string,
  cutoff: Date | null,
): Promise<Record<string, unknown>[]> {
  let q = db.from(table).select(columns).limit(100000);
  if (cutoff) q = q.gte('created_at', cutoff.toISOString());
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

function keep(userId: unknown, internal: Set<string>, exclude: boolean): boolean {
  if (!exclude) return true;
  return typeof userId !== 'string' || !internal.has(userId);
}

// A — DAU/WAU from audit_log login_success. Trend is daily distinct logins
// over a bounded window (period length, capped at 30 buckets) so "all"
// doesn't render hundreds of columns.
async function computeActivity(
  db: Db,
  q: AdminAnalyticsQuery,
  internal: Set<string>,
): Promise<AdminAnalyticsReport['activity']> {
  const trendDays = q.period === '7d' ? 7 : 30;
  const trendCutoff = new Date(Date.now() - trendDays * 24 * 60 * 60 * 1000);
  const cutoff = periodCutoff(q.period);
  // Trend needs at least the trend window even when period is longer/all.
  const fetchCutoff =
    cutoff && cutoff < trendCutoff ? cutoff : trendCutoff;

  const rows = await fetchRows(
    db,
    'audit_log',
    'user_id, created_at, event_type',
    fetchCutoff,
  ).then((r) => r.filter((x) => x.event_type === 'login_success'));

  const kept = rows.filter((r) => keep(r.user_id, internal, q.excludeInternal));

  // Daily distinct-user buckets over the trend window.
  const byDay = new Map<string, Set<string>>();
  const todayKey = seoulDay(new Date().toISOString());
  const wauCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const dauUsers = new Set<string>();
  const wauUsers = new Set<string>();
  const periodUsers = new Set<string>();

  for (const r of kept) {
    const uid = typeof r.user_id === 'string' ? r.user_id : null;
    if (!uid) continue;
    const iso = r.created_at as string;
    const ts = new Date(iso).getTime();
    if (!cutoff || ts >= cutoff.getTime()) periodUsers.add(uid);
    if (ts < trendCutoff.getTime()) continue;
    const day = seoulDay(iso);
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day)!.add(uid);
    if (day === todayKey) dauUsers.add(uid);
    if (ts >= wauCutoff) wauUsers.add(uid);
  }

  // Emit a continuous series so zero-login days still appear.
  const trend: SeriesPoint[] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = seoulDay(d.toISOString());
    trend.push({ name: key.slice(5), value: byDay.get(key)?.size ?? 0 });
  }

  return {
    dauToday: dauUsers.size,
    wau7d: wauUsers.size,
    periodDistinctUsers: periodUsers.size,
    trend,
  };
}

// B — feature usage from credit_transactions, stacked by reason segment.
async function computeFeatureUsage(
  db: Db,
  q: AdminAnalyticsQuery,
  internal: Set<string>,
): Promise<FeatureUsageRow[]> {
  const rows = await fetchRows(
    db,
    'credit_transactions',
    'user_id, feature, reason',
    periodCutoff(q.period),
  );
  const byFeature = new Map<string, FeatureUsageRow>();
  for (const r of rows) {
    if (!keep(r.user_id, internal, q.excludeInternal)) continue;
    const feature = (r.feature as string | null) ?? 'unknown';
    let row = byFeature.get(feature);
    if (!row) {
      row = {
        feature,
        total: 0,
        byReason: {
          unlimited_use: 0,
          trial_use: 0,
          feature_use: 0,
          feature_refund: 0,
          other: 0,
        },
      };
      byFeature.set(feature, row);
    }
    row.total += 1;
    row.byReason[reasonSegment(r.reason as string | null)] += 1;
  }
  return [...byFeature.values()].sort((a, b) => b.total - a.total);
}

// C — widget success/fail from the job-status tables.
async function computeWidgetHealth(
  db: Db,
  q: AdminAnalyticsQuery,
  internal: Set<string>,
): Promise<WidgetHealthRow[]> {
  const cutoff = periodCutoff(q.period);
  const rows = await Promise.all(
    WIDGET_HEALTH_SOURCES.map(async (src) => {
      // translate_sessions keys the user on host_user_id, not user_id.
      const userCol = src.table === 'translate_sessions' ? 'host_user_id' : 'user_id';
      // Terminal-status column — 'status' unless the table's lifecycle lives
      // elsewhere (interview V2 → index_status). Aliased back to `status` in
      // the select so the row-reading loop stays column-agnostic.
      const statusCol = src.statusColumn ?? 'status';
      const health: WidgetHealthRow = {
        widget: src.table,
        label: src.label,
        total: 0,
        success: 0,
        fail: 0,
        other: 0,
        errorRate: null,
      };
      try {
        const data = await fetchRows(
          db,
          src.table,
          statusCol === 'status'
            ? `${userCol}, status`
            : `${userCol}, status:${statusCol}`,
          cutoff,
        );
        for (const r of data) {
          if (!keep(r[userCol], internal, q.excludeInternal)) continue;
          const status = r.status as string | null;
          health.total += 1;
          if (status && src.success.includes(status)) health.success += 1;
          else if (status && src.fail.includes(status)) health.fail += 1;
          else health.other += 1;
        }
        const terminal = health.success + health.fail;
        health.errorRate = terminal > 0 ? health.fail / terminal : null;
      } catch {
        // Table missing on this env (migration not applied) → degrade to a
        // zero row rather than failing the whole dashboard.
      }
      return health;
    }),
  );
  return rows;
}

// D — interview funnel: projects → jobs(done) → search_queries.
async function computeInterviewFunnel(
  db: Db,
  q: AdminAnalyticsQuery,
  internal: Set<string>,
): Promise<FunnelStage[]> {
  const cutoff = periodCutoff(q.period);

  const [projects, jobs, queries] = await Promise.all([
    fetchRows(db, 'interview_projects', 'user_id', cutoff),
    fetchRows(db, 'interview_jobs', 'user_id, status', cutoff),
    fetchRows(db, 'interview_search_queries', 'user_id', cutoff),
  ]);

  const stage = (
    key: string,
    label: string,
    rows: Record<string, unknown>[],
    filter?: (r: Record<string, unknown>) => boolean,
  ) => {
    const users = new Set<string>();
    let count = 0;
    for (const r of rows) {
      if (!keep(r.user_id, internal, q.excludeInternal)) continue;
      if (filter && !filter(r)) continue;
      count += 1;
      if (typeof r.user_id === 'string') users.add(r.user_id);
    }
    return { stage: key, label, rows: count, users: users.size };
  };

  const s1 = stage('created', '생성', projects);
  const s2 = stage('analyzed', '분석 완료', jobs, (r) => r.status === 'done');
  const s3 = stage('queried', '추가 질문', queries);

  const withConv = (
    s: { stage: string; label: string; rows: number; users: number },
    prev: number | null,
  ): FunnelStage => ({
    ...s,
    conversion: prev && prev > 0 ? s.users / prev : null,
  });

  return [
    withConv(s1, null),
    withConv(s2, s1.users),
    withConv(s3, s2.users),
  ];
}

// Referrer hosts we treat as organic search. Matched as a substring so
// locale/subdomain variants (google.co.kr, www.bing.com, m.search.naver.com)
// all resolve to the same bucket.
const SEARCH_ENGINE_HOSTS = [
  'google.',
  'bing.',
  'naver.',
  'daum.',
  'yahoo.',
  'duckduckgo.',
  'baidu.',
  'yandex.',
  'ecosia.',
  'kagi.',
  'search.brave.',
];

function isSearchHost(host: string): boolean {
  const h = host.toLowerCase();
  return SEARCH_ENGINE_HOSTS.some((s) => h.includes(s));
}

// Trim to a non-empty string or null — landing_visits stores '' and null both.
function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function sourceBucket(row: Record<string, unknown>): SourceBucketKey {
  if (nonEmpty(row.utm_source)) return 'campaign';
  const host = nonEmpty(row.referrer_host);
  if (!host) return 'direct';
  if (isSearchHost(host)) return 'organic';
  return 'referral';
}

const SOURCE_BUCKET_ORDER: SourceBucketKey[] = [
  'direct',
  'organic',
  'referral',
  'campaign',
];

// Landing traffic (#575): visitor trend + source breakdown + retention funnel.
// The whole section degrades to `available: false` (rather than 500-ing the
// dashboard) when landing_visits is missing on this env.
async function computeLandingTraffic(
  db: Db,
  q: AdminAnalyticsQuery,
  internal: Set<string>,
): Promise<LandingTraffic> {
  const cutoff = periodCutoff(q.period);
  const cutoffTs = cutoff?.getTime() ?? -Infinity;
  const trendDays = q.period === '7d' ? 7 : 30;
  const trendCutoffTs = Date.now() - trendDays * 24 * 60 * 60 * 1000;

  const empty: LandingTraffic = {
    periodVisitors: 0,
    periodNewVisitors: 0,
    periodReturning: 0,
    trend: [],
    sources: { totalVisits: 0, buckets: [] },
    retention: [],
    available: false,
  };

  let all: Record<string, unknown>[];
  try {
    // All-time visits (minimal cols) so new-vs-returning is judged against
    // each session's *global* first appearance, not just the window.
    all = await fetchRows(
      db,
      'landing_visits',
      'session_id, created_at, referrer_host, utm_source',
      null,
    );
  } catch {
    return empty; // table not applied on this env → capture 대기
  }

  // Global first-seen timestamp per session_id.
  const firstSeen = new Map<string, number>();
  for (const r of all) {
    const sid = nonEmpty(r.session_id);
    if (!sid) continue;
    const ts = new Date(r.created_at as string).getTime();
    const prev = firstSeen.get(sid);
    if (prev === undefined || ts < prev) firstSeen.set(sid, ts);
  }

  // Daily distinct-session buckets over the trend window, split new/returning.
  const byDayNew = new Map<string, Set<string>>();
  const byDayRet = new Map<string, Set<string>>();
  const periodSessions = new Set<string>();
  const periodNew = new Set<string>();

  for (const r of all) {
    const sid = nonEmpty(r.session_id);
    if (!sid) continue;
    const iso = r.created_at as string;
    const ts = new Date(iso).getTime();
    const first = firstSeen.get(sid)!;
    if (ts >= cutoffTs) {
      periodSessions.add(sid);
      if (first >= cutoffTs) periodNew.add(sid);
    }
    if (ts < trendCutoffTs) continue;
    const day = seoulDay(iso);
    // First-ever visit day → 신규 for that day; any later day → 재방문.
    const isNewToday = seoulDay(new Date(first).toISOString()) === day;
    const target = isNewToday ? byDayNew : byDayRet;
    if (!target.has(day)) target.set(day, new Set());
    target.get(day)!.add(sid);
  }

  // Continuous series so zero-visit days still render.
  const trend: LandingTrendPoint[] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = seoulDay(d.toISOString());
    trend.push({
      name: key.slice(5),
      newVisitors: byDayNew.get(key)?.size ?? 0,
      returning: byDayRet.get(key)?.size ?? 0,
    });
  }

  // Source breakdown over the window (visit counts, 전수 anonymous).
  const bucketAgg = new Map<SourceBucketKey, Map<string, number>>();
  const bucketTotal = new Map<SourceBucketKey, number>();
  let totalVisits = 0;
  for (const r of all) {
    const ts = new Date(r.created_at as string).getTime();
    if (ts < cutoffTs) continue;
    totalVisits += 1;
    const bucket = sourceBucket(r);
    bucketTotal.set(bucket, (bucketTotal.get(bucket) ?? 0) + 1);
    const label =
      bucket === 'direct'
        ? '직접 유입'
        : bucket === 'campaign'
          ? (nonEmpty(r.utm_source) ?? '캠페인')
          : (nonEmpty(r.referrer_host) ?? '기타');
    if (!bucketAgg.has(bucket)) bucketAgg.set(bucket, new Map());
    const m = bucketAgg.get(bucket)!;
    m.set(label, (m.get(label) ?? 0) + 1);
  }
  const buckets: SourceBucket[] = SOURCE_BUCKET_ORDER.map((key) => {
    const m = bucketAgg.get(key) ?? new Map<string, number>();
    const top = [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    return { bucket: key, total: bucketTotal.get(key) ?? 0, top };
  });

  // Retention funnel: 방문(sessions, 전수) → 가입(profiles created in window) →
  // 활성(users whose *first* credit_transaction lands in the window). Internal
  // exclusion applies to signup/active only — never to the anonymous visit.
  const visitCount = periodSessions.size;

  let signupCount = 0;
  try {
    const profiles = await fetchRows(db, 'profiles', 'id, created_at', cutoff);
    for (const p of profiles) {
      if (!keep(p.id, internal, q.excludeInternal)) continue;
      signupCount += 1;
    }
  } catch {
    // profiles unreachable → leave 0 rather than failing the section.
  }

  let activeCount = 0;
  try {
    const tx = await fetchRows(
      db,
      'credit_transactions',
      'user_id, created_at',
      null,
    );
    const firstTx = new Map<string, number>();
    for (const t of tx) {
      const uid = nonEmpty(t.user_id);
      if (!uid) continue;
      const ts = new Date(t.created_at as string).getTime();
      const prev = firstTx.get(uid);
      if (prev === undefined || ts < prev) firstTx.set(uid, ts);
    }
    for (const [uid, ts] of firstTx) {
      if (ts < cutoffTs) continue;
      if (!keep(uid, internal, q.excludeInternal)) continue;
      activeCount += 1;
    }
  } catch {
    // credit_transactions unreachable → leave 0.
  }

  const conv = (n: number, d: number): number | null => (d > 0 ? n / d : null);
  const retention: RetentionStage[] = [
    { stage: 'visit', label: '방문', count: visitCount, conversion: null },
    {
      stage: 'signup',
      label: '가입',
      count: signupCount,
      conversion: conv(signupCount, visitCount),
    },
    {
      stage: 'active',
      label: '활성',
      count: activeCount,
      conversion: conv(activeCount, signupCount),
    },
  ];

  return {
    periodVisitors: periodSessions.size,
    periodNewVisitors: periodNew.size,
    periodReturning: periodSessions.size - periodNew.size,
    trend,
    sources: { totalVisits, buckets },
    retention,
    available: true,
  };
}

// Cumulative headline totals: 전수 signup count + paid-revenue sum. Both are
// filter/period-independent, so this takes no query. Each figure degrades to
// 0 (rather than failing the whole dashboard) if its table is unreachable.
async function computeTotals(db: Db): Promise<CumulativeTotals> {
  // 전수 signup census — head+exact count, no rows returned.
  let users = 0;
  const usersRes = await db
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  if (!usersRes.error) users = usersRes.count ?? 0;

  // Paid revenue — sum amount_krw over status='paid' only, excluding rows
  // flagged is_test (test/non-real charges never reflect actual revenue).
  // `is_test IS NOT TRUE` keeps false + any legacy null. payments is tiny
  // (per-purchase rows), so summing in JS mirrors the file's fetch+reduce
  // pattern rather than reaching for a SQL aggregate.
  let revenueKrwPaid = 0;
  const payRes = await db
    .from('payments')
    .select('amount_krw')
    .eq('status', 'paid')
    .not('is_test', 'is', true);
  if (!payRes.error) {
    for (const r of payRes.data ?? []) {
      const v = (r as { amount_krw: number | null }).amount_krw;
      if (typeof v === 'number') revenueKrwPaid += v;
    }
  }

  return { users, revenueKrwPaid };
}

export async function getAdminAnalytics(
  query: AdminAnalyticsQuery,
): Promise<AdminAnalyticsReport> {
  const db = createAdminClient();
  const internal = await internalUserIds(db);

  const [activity, featureUsage, widgetHealth, interviewFunnel, landing, totals] =
    await Promise.all([
      computeActivity(db, query, internal),
      computeFeatureUsage(db, query, internal),
      computeWidgetHealth(db, query, internal),
      computeInterviewFunnel(db, query, internal),
      computeLandingTraffic(db, query, internal),
      computeTotals(db),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    period: query.period,
    excludeInternal: query.excludeInternal,
    internalAccountCount: internal.size,
    totals,
    activity,
    featureUsage,
    widgetHealth,
    interviewFunnel,
    landing,
  };
}

export function parseAnalyticsQuery(params: URLSearchParams): AdminAnalyticsQuery {
  const rawPeriod = params.get('period');
  const period: AnalyticsPeriod =
    rawPeriod === '7d' || rawPeriod === '30d' || rawPeriod === 'all'
      ? rawPeriod
      : '30d';
  // Default to excluding internal accounts (spec: internal pollution guard).
  const excludeInternal = params.get('excludeInternal') !== 'false';
  return { period, excludeInternal };
}

export const REASON_SEGMENT_ORDER = REASON_SEGMENTS;

/* ────────────────────────────────────────────────────────────────────
   Signup account roster (auth.users) — super-admin only.

   Full census of registered accounts, independent of the behavioural
   dashboard's period/exclude filters (the roster is 전수 — every account,
   with internal/super accounts *badged* rather than dropped). Uses the
   service-role admin API `listUsers` paginated sweep and returns only the
   minimal display fields — never the raw GoTrue user object, tokens, or
   app_metadata blob.
   ──────────────────────────────────────────────────────────────────── */

export type SignupAccount = {
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  // Sign-in provider (email / google / …) from app_metadata.provider.
  provider: string | null;
  // True for super-admin, unlimited-org members/owners, QA testers — shown
  // as a badge (roster is 전수, so these are surfaced, not excluded).
  isInternal: boolean;
};

export type SignupRoster = {
  total: number;
  accounts: SignupAccount[];
};

// admin.auth.admin.listUsers caps perPage at 1000. We sweep every page and
// stop when a short page signals the end, so the roster is complete without
// a separate count query.
const LIST_USERS_PER_PAGE = 1000;
// Backstop so a runaway account table can't loop forever (1000 pages =
// 1,000,000 accounts — far past any realistic size).
const LIST_USERS_MAX_PAGES = 1000;

export async function listAllSignupEmails(): Promise<SignupRoster> {
  const db = createAdminClient();
  const internal = await internalUserIds(db);

  const accounts: SignupAccount[] = [];
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PER_PAGE,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      const provider =
        typeof u.app_metadata?.provider === 'string'
          ? u.app_metadata.provider
          : null;
      accounts.push({
        email: u.email ?? '—',
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        provider,
        isInternal: internal.has(u.id) || isSuperAdminEmail(u.email),
      });
    }
    if (users.length < LIST_USERS_PER_PAGE) break;
  }

  accounts.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return { total: accounts.length, accounts };
}
