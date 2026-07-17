/* ────────────────────────────────────────────────────────────────────
   Per-user activity timeline — super-admin "user observation" drawer.

   Reconstructs a single user's platform activity by querying every domain
   table that carries a per-user timestamp, normalizing each row into a
   unified TimelineEvent, and merging them into one reverse-chronological
   stream. A deterministic summary (sessions, dwell, funnel, top features,
   credits) sits on top. No AI narrative — pure DB reconstruction.

   ⚠️ Privacy departure: the rest of /admin/analytics is aggregate-count
   only and never reads raw per-user rows. This module deliberately reads
   per-user detail, so it is super-admin gated at the route boundary and
   every access is written to audit_log (see the route handler). Read-only —
   nothing here mutates user data.

   Cost model: exactly one query per source table (no N+1). Every query is
   filtered by the user, ordered created_at desc, and capped, so a heavy
   user can't unbound the request. Pagination uses a created_at cursor
   (`before`): to get the newest K of the union we fetch the newest K from
   each table and merge — the union's top K is guaranteed present.
   ──────────────────────────────────────────────────────────────────── */

import { createAdminClient } from '@/lib/supabase/admin';

type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

export type TimelineCategory =
  | 'account'
  | 'integration'
  | 'project'
  | 'interview'
  | 'transcript'
  | 'desk'
  | 'video'
  | 'probing'
  | 'recruiting'
  | 'scheduler'
  | 'payment'
  | 'credit'
  | 'auth'
  | 'activity';

export type TimelineEvent = {
  ts: string; // ISO — the created_at that also drives the cursor
  category: TimelineCategory;
  action: string; // human-readable label (Korean — admin surface)
  detail?: string | null;
  status?: string | null;
  durationMs?: number | null;
  artifact?: { label: string; href?: string } | null;
};

export type FunnelStageKey =
  | 'signup'
  | 'first_project'
  | 'first_transcript'
  | 'first_report'
  | 'first_payment';

export type FunnelStage = {
  key: FunnelStageKey;
  label: string;
  reachedAt: string | null;
};

export type TopFeature = { feature: string; count: number };

export type UserTimelineSummary = {
  email: string | null;
  signupAt: string | null;
  lastActivityAt: string | null;
  totalSessions: number; // login_success count (audit_log)
  // 근사치: 처리한 미디어(전사·영상) 길이 합. 로그아웃 이벤트가 없어 세션
  // 체류를 직접 잴 수 없으므로 "실제 소비/처리" 시간을 dwell 프록시로 쓴다.
  mediaProcessedMs: number;
  funnel: FunnelStage[];
  furthestFunnel: FunnelStageKey | null;
  topFeatures: TopFeature[];
  creditsPurchased: number;
  creditsSpent: number;
  amountPaidKrw: number;
};

export type UserTimelinePage = {
  events: TimelineEvent[];
  hasMore: boolean;
  nextCursor: string | null; // ISO — pass back as `before`
};

export type UserTimeline = UserTimelinePage & {
  // Only present on the first page (before == null); subsequent pages omit
  // it since the summary is filter-independent, not per-page.
  summary: UserTimelineSummary | null;
};

// ── small value coercers (rows are loosely typed) ──────────────────────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function spanMs(created: unknown, updated: unknown): number | null {
  const a = str(created);
  const b = str(updated);
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms > 0 ? ms : null;
}

// Resilient per-user fetch: exactly one query, user-filtered, newest-first,
// capped, with an optional created_at cursor. A missing table (e.g.
// user_activity before #610) or a schema drift is logged and skipped rather
// than blanking the whole timeline.
async function fetchUserRows(
  db: Db,
  table: string,
  userCol: string,
  userId: string,
  columns: string,
  before: string | null,
  limit: number,
): Promise<Row[]> {
  let q = db
    .from(table)
    .select(columns)
    .eq(userCol, userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) {
    console.warn(`[user-timeline] ${table} skipped: ${error.message}`);
    return [];
  }
  return (data ?? []) as unknown as Row[];
}

// Earliest created_at (or a chosen ts column) for one source — powers the
// funnel. Returns null when the user never reached that stage.
async function firstTs(
  db: Db,
  table: string,
  userCol: string,
  userId: string,
  tsCol = 'created_at',
  eqExtra?: { col: string; val: string },
): Promise<string | null> {
  let q = db
    .from(table)
    .select(tsCol)
    .eq(userCol, userId)
    .not(tsCol, 'is', null)
    .order(tsCol, { ascending: true })
    .limit(1);
  if (eqExtra) q = q.eq(eqExtra.col, eqExtra.val);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return null;
  return str((data[0] as unknown as Row)[tsCol]);
}

const AUDIT_LABELS: Record<string, string> = {
  login_success: '로그인',
  login_failure: '로그인 실패',
  consent_granted: '개인정보 동의',
  consent_revoked: '동의 철회',
  consent_version_updated: '동의 버전 갱신',
  data_export_requested: '데이터 내보내기 요청',
  data_export_completed: '데이터 내보내기 완료',
  account_deletion_requested: '계정 삭제 요청',
  account_deletion_completed: '계정 삭제 완료',
  admin_action: '관리자 작업',
  admin_impersonation: '관리자 열람',
  rate_limited: '레이트리밋',
  permission_denied: '접근 거부',
};

// Human labels for user_activity event keys (#610). Defensive: the table may
// not exist yet, and unknown keys fall back to the raw key.
const ACTIVITY_LABELS: Record<string, string> = {
  subscription_toggle: '구독 토글',
  pricing_view: '가격 페이지 열람',
  upgrade_click: '업그레이드 클릭',
};

// ── one source → TimelineEvent[] mapping ───────────────────────────────
// Each mapper reads only the columns fetched for that table. `ts` is always
// the created_at we filtered/ordered on, keeping cursor pagination coherent.
function mapEvents(source: string, rows: Row[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const r of rows) {
    const ts = str(r.created_at);
    if (!ts && source !== 'user_activity') continue;
    switch (source) {
      case 'profiles':
        out.push({
          ts: ts!,
          category: 'account',
          action: '가입',
          detail: str(r.email) ?? str(r.full_name),
        });
        break;
      case 'user_google_oauth':
        out.push({
          ts: ts!,
          category: 'integration',
          action: 'Google 연동',
          detail: str(r.email),
        });
        break;
      case 'user_notion_oauth':
        out.push({
          ts: ts!,
          category: 'integration',
          action: 'Notion 연동',
          detail: str(r.workspace_name),
        });
        break;
      case 'interview_projects':
        out.push({
          ts: ts!,
          category: 'project',
          action: '프로젝트 생성',
          detail: str(r.name),
        });
        break;
      case 'interview_jobs': {
        const status = str(r.status);
        out.push({
          ts: ts!,
          category: 'interview',
          action: '인터뷰 분석',
          status,
          durationMs: status === 'done' ? spanMs(r.created_at, r.updated_at) : null,
          detail: creditsNote(r.credits_spent),
        });
        break;
      }
      case 'interview_chat_messages':
        out.push({
          ts: ts!,
          category: 'interview',
          action: str(r.role) === 'assistant' ? '인터뷰 챗 응답' : '인터뷰 챗 질문',
        });
        break;
      case 'transcript_jobs': {
        const secs = num(r.duration_seconds);
        out.push({
          ts: ts!,
          category: 'transcript',
          action: '전사',
          status: str(r.status),
          detail: str(r.filename),
          durationMs: secs != null ? secs * 1000 : null,
        });
        break;
      }
      case 'desk_jobs':
        out.push({
          ts: ts!,
          category: 'desk',
          action: '데스크 리서치',
          status: str(r.status),
          detail: keywordsNote(r.keywords),
        });
        break;
      case 'video_jobs': {
        const secs = num(r.duration_seconds);
        out.push({
          ts: ts!,
          category: 'video',
          action: '영상 분석',
          status: str(r.status),
          detail: str(r.filename),
          durationMs: secs != null ? secs * 1000 : null,
        });
        break;
      }
      case 'probing_sessions':
        out.push({
          ts: ts!,
          category: 'probing',
          action: '프로빙 리서치 설정',
          detail: str(r.research_goal),
        });
        break;
      case 'probing_questions':
        out.push({
          ts: ts!,
          category: 'probing',
          action: '프로빙 질문 생성',
          detail: str(r.technique),
        });
        break;
      case 'probing_suggestions':
        out.push({
          ts: ts!,
          category: 'probing',
          action: '프로빙 제안 세트',
        });
        break;
      case 'recruiting_forms':
        out.push({
          ts: ts!,
          category: 'recruiting',
          action: '모집 폼 생성',
          status: str(r.status),
          detail: str(r.title),
        });
        break;
      case 'recruiting_invitations':
        out.push({
          ts: ts!,
          category: 'recruiting',
          action: '모집 초대',
          status: str(r.status),
        });
        break;
      case 'scheduler_booking_links':
        out.push({
          ts: ts!,
          category: 'scheduler',
          action: '스케줄러 예약 링크',
          status: str(r.status),
          detail: str(r.title),
        });
        break;
      case 'payments': {
        const credits = num(r.credits);
        out.push({
          ts: ts!,
          category: 'payment',
          action: '크레딧 구매',
          status: str(r.status),
          detail: paymentNote(r),
          artifact: credits != null ? { label: `${credits.toLocaleString()}cr` } : null,
        });
        break;
      }
      case 'credit_transactions': {
        const delta = num(r.delta) ?? 0;
        out.push({
          ts: ts!,
          category: 'credit',
          action: delta >= 0 ? '크레딧 적립' : '크레딧 사용',
          detail: str(r.feature) ?? str(r.reason),
          artifact: { label: `${delta > 0 ? '+' : ''}${delta}cr` },
        });
        break;
      }
      case 'audit_log': {
        const ev = str(r.event_type) ?? 'event';
        out.push({
          ts: ts!,
          category: ev.startsWith('login') ? 'auth' : 'account',
          action: AUDIT_LABELS[ev] ?? ev,
        });
        break;
      }
      case 'user_activity': {
        const at = str(r.created_at) ?? str(r.occurred_at) ?? str(r.ts);
        if (!at) break;
        const key =
          str(r.event_key) ?? str(r.event) ?? str(r.action) ?? str(r.name) ?? 'activity';
        out.push({
          ts: at,
          category: 'activity',
          action: `[클릭] ${ACTIVITY_LABELS[key] ?? key}`,
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function creditsNote(v: unknown): string | null {
  const c = num(v);
  return c && c > 0 ? `${c}cr 사용` : null;
}
function keywordsNote(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const list = v.filter((k): k is string => typeof k === 'string');
  if (list.length === 0) return null;
  const head = list.slice(0, 3).join(', ');
  return list.length > 3 ? `${head} 외 ${list.length - 3}` : head;
}
function paymentNote(r: Row): string | null {
  const usd = num(r.amount_usd);
  const krw = num(r.amount_krw);
  if (str(r.currency) === 'USD' && usd != null) return `$${usd.toLocaleString()}`;
  if (krw != null) return `₩${krw.toLocaleString()}`;
  return null;
}

// Every source table + its per-user column + the columns each mapper needs.
const SOURCES: { table: string; userCol: string; columns: string }[] = [
  { table: 'profiles', userCol: 'id', columns: 'id, email, full_name, created_at' },
  { table: 'user_google_oauth', userCol: 'user_id', columns: 'user_id, email, created_at' },
  { table: 'user_notion_oauth', userCol: 'user_id', columns: 'user_id, workspace_name, created_at' },
  { table: 'interview_projects', userCol: 'user_id', columns: 'user_id, name, created_at' },
  { table: 'interview_jobs', userCol: 'user_id', columns: 'user_id, status, credits_spent, created_at, updated_at' },
  { table: 'interview_chat_messages', userCol: 'user_id', columns: 'user_id, role, created_at' },
  { table: 'transcript_jobs', userCol: 'user_id', columns: 'user_id, filename, status, duration_seconds, created_at' },
  { table: 'desk_jobs', userCol: 'user_id', columns: 'user_id, keywords, status, created_at' },
  { table: 'video_jobs', userCol: 'user_id', columns: 'user_id, filename, status, duration_seconds, created_at' },
  { table: 'probing_sessions', userCol: 'user_id', columns: 'user_id, research_goal, created_at' },
  { table: 'probing_questions', userCol: 'user_id', columns: 'user_id, technique, created_at' },
  { table: 'probing_suggestions', userCol: 'user_id', columns: 'user_id, created_at' },
  { table: 'recruiting_forms', userCol: 'user_id', columns: 'user_id, title, status, created_at' },
  { table: 'recruiting_invitations', userCol: 'requester_user_id', columns: 'requester_user_id, status, created_at' },
  { table: 'scheduler_booking_links', userCol: 'user_id', columns: 'user_id, title, slug, status, created_at' },
  { table: 'payments', userCol: 'user_id', columns: 'user_id, credits, amount_krw, amount_usd, currency, status, created_at' },
  { table: 'credit_transactions', userCol: 'user_id', columns: 'user_id, delta, reason, feature, created_at' },
  { table: 'audit_log', userCol: 'user_id', columns: 'user_id, event_type, created_at' },
  // Defensive (#610 may not be merged): select '*' so whatever columns exist
  // come back; a missing table / wrong user column is logged and skipped.
  { table: 'user_activity', userCol: 'user_id', columns: '*' },
];

export type FetchOpts = { before?: string | null; limit?: number };

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 300;

// One merged, paginated page of the user's timeline. To surface the newest
// K of the union we fetch the newest K per table (each already user-filtered
// + cursor-bounded) and merge — so `hasMore`/`nextCursor` stay correct.
export async function getUserTimelinePage(
  db: Db,
  userId: string,
  opts: FetchOpts = {},
): Promise<UserTimelinePage> {
  const before = opts.before ?? null;
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const perTable = await Promise.all(
    SOURCES.map((s) =>
      fetchUserRows(db, s.table, s.userCol, userId, s.columns, before, limit).then((rows) =>
        mapEvents(s.table, rows),
      ),
    ),
  );

  const merged = perTable
    .flat()
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const nextCursor = hasMore ? page[page.length - 1]?.ts ?? null : null;
  return { events: page, hasMore, nextCursor };
}

// Filter-independent summary — computed once for the first page. Each metric
// is its own cheap, minimal-column query (aggregates that pagination can't
// see). All run in parallel.
export async function getUserTimelineSummary(
  db: Db,
  userId: string,
  email: string | null,
  newestEventTs: string | null,
): Promise<UserTimelineSummary> {
  const [
    sessions,
    payments,
    credits,
    transcriptSecs,
    videoSecs,
    fSignup,
    fProject,
    fTranscript,
    fReport,
    fPayment,
  ] = await Promise.all([
    // login_success count
    db
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'login_success')
      .then((r) => r.count ?? 0),
    // payments (small per user) — sum paid credits + KRW
    fetchUserRows(db, 'payments', 'user_id', userId, 'credits, amount_krw, status, created_at', null, 1000),
    // credit ledger — spent + feature frequency (capped)
    fetchUserRows(db, 'credit_transactions', 'user_id', userId, 'delta, reason, feature, created_at', null, 5000),
    // media length processed (dwell proxy)
    fetchUserRows(db, 'transcript_jobs', 'user_id', userId, 'duration_seconds, created_at', null, 2000),
    fetchUserRows(db, 'video_jobs', 'user_id', userId, 'duration_seconds, created_at', null, 2000),
    firstTs(db, 'profiles', 'id', userId),
    firstTs(db, 'interview_projects', 'user_id', userId),
    firstTs(db, 'transcript_jobs', 'user_id', userId),
    firstTs(db, 'desk_jobs', 'user_id', userId),
    firstTs(db, 'payments', 'user_id', userId, 'created_at', { col: 'status', val: 'paid' }),
  ]);

  let creditsPurchased = 0;
  let amountPaidKrw = 0;
  for (const p of payments) {
    if (str(p.status) !== 'paid') continue;
    creditsPurchased += num(p.credits) ?? 0;
    amountPaidKrw += num(p.amount_krw) ?? 0;
  }

  let creditsSpent = 0;
  const featureCounts = new Map<string, number>();
  for (const t of credits) {
    const delta = num(t.delta) ?? 0;
    if (delta < 0) creditsSpent += -delta;
    const feat = str(t.feature);
    if (feat) featureCounts.set(feat, (featureCounts.get(feat) ?? 0) + 1);
  }
  const topFeatures: TopFeature[] = [...featureCounts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mediaProcessedMs =
    transcriptSecs.reduce((sum, r) => sum + (num(r.duration_seconds) ?? 0), 0) * 1000 +
    videoSecs.reduce((sum, r) => sum + (num(r.duration_seconds) ?? 0), 0) * 1000;

  const funnel: FunnelStage[] = [
    { key: 'signup', label: '가입', reachedAt: fSignup },
    { key: 'first_project', label: '첫 프로젝트', reachedAt: fProject },
    { key: 'first_transcript', label: '첫 전사', reachedAt: fTranscript },
    { key: 'first_report', label: '첫 리포트', reachedAt: fReport },
    { key: 'first_payment', label: '첫 결제', reachedAt: fPayment },
  ];
  let furthestFunnel: FunnelStageKey | null = null;
  for (const stage of funnel) {
    if (stage.reachedAt) furthestFunnel = stage.key;
  }

  return {
    email,
    signupAt: fSignup,
    lastActivityAt: newestEventTs,
    totalSessions: sessions,
    mediaProcessedMs,
    funnel,
    furthestFunnel,
    topFeatures,
    creditsPurchased,
    creditsSpent,
    amountPaidKrw,
  };
}

// Convenience: first page (events + summary) or a subsequent page (events
// only). The route decides which based on the `before` cursor.
export async function getUserTimeline(
  userId: string,
  opts: FetchOpts & { email?: string | null } = {},
): Promise<UserTimeline> {
  const db = createAdminClient();
  const page = await getUserTimelinePage(db, userId, opts);
  const summary =
    opts.before == null
      ? await getUserTimelineSummary(db, userId, opts.email ?? null, page.events[0]?.ts ?? null)
      : null;
  return { ...page, summary };
}
