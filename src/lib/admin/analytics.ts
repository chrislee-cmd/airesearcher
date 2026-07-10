import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { superAdminEmails } from './superadmin';

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

export type AdminAnalyticsReport = {
  generatedAt: string;
  period: AnalyticsPeriod;
  excludeInternal: boolean;
  internalAccountCount: number;
  activity: {
    dauToday: number;
    wau7d: number;
    periodDistinctUsers: number;
    trend: SeriesPoint[]; // daily distinct logins
  };
  featureUsage: FeatureUsageRow[];
  widgetHealth: WidgetHealthRow[];
  interviewFunnel: FunnelStage[];
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

export async function getAdminAnalytics(
  query: AdminAnalyticsQuery,
): Promise<AdminAnalyticsReport> {
  const db = createAdminClient();
  const internal = await internalUserIds(db);

  const [activity, featureUsage, widgetHealth, interviewFunnel] =
    await Promise.all([
      computeActivity(db, query, internal),
      computeFeatureUsage(db, query, internal),
      computeWidgetHealth(db, query, internal),
      computeInterviewFunnel(db, query, internal),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    period: query.period,
    excludeInternal: query.excludeInternal,
    internalAccountCount: internal.size,
    activity,
    featureUsage,
    widgetHealth,
    interviewFunnel,
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
