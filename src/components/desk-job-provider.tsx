'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from './auth-provider';
import type { DeskArticle, DeskSkipReason, DeskSourceId } from '@/lib/desk-sources';

export type DeskJobStatus =
  | 'queued'
  | 'expanding'
  | 'crawling'
  | 'summarizing'
  | 'done'
  | 'error'
  | 'cancelled';

export type DeskJobProgress = {
  phase?:
    | 'expanding'
    | 'scoping'
    | 'crawling'
    | 'extracting'
    | 'drafting'
    | 'critiquing'
    | 'synthesizing'
    | 'summarizing';
  crawl_total?: number;
  crawl_done?: number;
  events: string[];
  // Per-phase wall-clock breakdown — server records elapsed ms when each
  // phase closes. Used by the watchdog banner and admin diagnostics.
  timings?: Partial<{
    expanding_ms: number;
    scoping_ms: number;
    crawling_ms: number;
    gating_ms: number;
    sampling_ms: number;
    extracting_ms: number;
    drafting_ms: number;
    critiquing_ms: number;
    synthesizing_ms: number;
    analytics_ms: number;
    summarizing_ms: number;
  }>;
  // Cumulative wall-clock since runJob() began.
  elapsed_ms?: number;
  // The HARD_DEADLINE_MS the server is running against (so UI can show
  // "X초 남음" without hard-coding the budget).
  deadline_ms?: number;
  // Steps the budget-skip logic intentionally bypassed.
  skipped_steps?: string[];
};

export type DeskRqAnswer = {
  rq_id: string;
  answer_md: string;
  confidence: 'high' | 'medium' | 'low';
  weaknesses: string[];
  missing_data: string[];
  cited_article_urls: string[];
};

export type DeskResearchQuestion = {
  id: string;
  question: string;
  category:
    | 'market_size'
    | 'competition'
    | 'trends'
    | 'regulation_risk'
    | 'user_signals'
    | 'business_model'
    | 'technology';
  importance: number;
};

export type DeskClaim =
  | {
      kind: 'quant';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      value: string;
      unit?: string;
      subject: string;
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    }
  | {
      kind: 'entity';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      name: string;
      role: 'company' | 'person' | 'product' | 'org';
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    };

export type DeskChart = {
  type: 'bar' | 'pie';
  title: string;
  insight: string;
  unit: 'percent' | 'count';
  // 한 막대를 강조할 라벨 — data[].label 과 매칭되면 액센트 색으로 렌더한다.
  // P3 "국내 vs G7 대비" 차트가 한국 막대를 G7 사이에서 부각하는 데 쓴다. 옵셔널.
  highlight?: string;
  // display = 코드가 미리 포맷한 값 라벨(예: "$1.9T"). 있으면 패널이 unit 기반
  // 자동 라벨 대신 이걸 그대로 쓴다 — USD 원값(수조 단위)을 사람이 읽게. 옵셔널.
  data: { label: string; value: number; display?: string }[];
};

export type DeskAnalytics = {
  charts: DeskChart[];
};

export type DeskJob = {
  id: string;
  keywords: string[];
  // 리서치 목적 mode (데스크 v2). optional — mode 컬럼 마이그 적용 전 API
  // 응답에 없을 수 있다. custom mode 는 제거됐지만 옛 job row 는 여전히
  // mode='custom' 을 담고 있을 수 있다 — 그런 row 는 result view 가 'market'
  // 이 아닌 값으로 취급해 공용 markdown 리포트로 graceful 하게 렌더한다.
  mode?: 'trend' | 'market';
  sources: DeskSourceId[];
  locale: string;
  date_from: string | null;
  date_to: string | null;
  status: DeskJobStatus;
  progress: DeskJobProgress;
  similar_keywords: string[];
  // Heavy JSON columns — the list endpoint omits them (each is 100KB~1MB per
  // row and full-column lists were timing out at 36s+, 2026-07-05 incident).
  // They are hydrated from /api/desk/jobs/[id] for the session's latest done
  // job (see refresh below); absent (undefined) means "not fetched", null
  // means "fetched, empty".
  output?: string | null;
  articles?: DeskArticle[] | null;
  analytics?: DeskAnalytics | null;
  research_questions?: DeskResearchQuestion[] | null;
  claims?: DeskClaim[] | null;
  rq_answers?: DeskRqAnswer[] | null;
  // `reason` distinguishes a missing key ('no_key') from a runtime API failure
  // (invalid_key / rate_limited / fetch_failed). Optional for back-compat: rows
  // written before this change persist as `{ source, missing }` with no reason —
  // the banner treats a missing reason as 'no_key'.
  skipped:
    | { source: DeskSourceId; reason?: DeskSkipReason; missing?: string }[]
    | null;
  error_message: string | null;
  generation_id: string | null;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
};

const ACTIVE: DeskJobStatus[] = ['queued', 'expanding', 'crawling', 'summarizing'];

type Ctx = {
  jobs: DeskJob[];
  isWorking: boolean;
  /**
   * Most recent job created *this session* — what the card body renders.
   * Session-scoped so a fresh visit lands on the idle input UI instead of
   * replaying a previous session's completed job (see sessionStart).
   */
  latestJob: DeskJob | null;
  refresh: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
};

const DeskJobCtx = createContext<Ctx | null>(null);

export function useDeskJobs() {
  const v = useContext(DeskJobCtx);
  if (!v) throw new Error('useDeskJobs must be used inside <DeskJobProvider>');
  return v;
}

export function DeskJobProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<DeskJob[]>([]);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>['channel']
  > | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  // Auth health gate. The realtime subscription on `desk_jobs` (below)
  // fires `refresh()` on every row change — an active scraping job can
  // emit dozens of progress events per minute. If the session expired
  // we'd hammer `/api/desk/jobs` with 401s once per event. Flip true on
  // the first 401, skip every subsequent fetch, and reset on user
  // identity change (re-login) or the next healthy response.
  const stopOnExpiredRef = useRef(false);
  const warnedExpiredOnceRef = useRef(false);

  // Session start timestamp (ms), captured once on mount. `jobs` still persists
  // every past run so a finished report survives refresh/relogin, but
  // `latestJob` — what the card body renders — is scoped to jobs created *this
  // session*. Without this a previous session's old completed job (DB order =
  // newest first) becomes `latestJob`, replaying its stale keyword input +
  // output UI when the user tries to start a fresh research run (겹침
  // regression, 2026-07-05). Lazy useState (not a ref) so the value is stable
  // and readable during render without tripping react-hooks/purity.
  const [sessionStart] = useState(() => Date.now());

  // Detail hydration cache — one full-column fetch per done job, keyed by id
  // and invalidated when updated_at moves. Realtime fires refresh() dozens of
  // times per run; without this every event would re-download the ~500KB row.
  const detailCacheRef = useRef(new Map<string, DeskJob>());

  const refresh = useCallback(async () => {
    if (!user) {
      setJobs([]);
      return;
    }
    if (stopOnExpiredRef.current) return;
    try {
      const res = await fetch('/api/desk/jobs', { cache: 'no-store' });
      if (res.status === 401) {
        stopOnExpiredRef.current = true;
        if (!warnedExpiredOnceRef.current) {
          console.warn(
            '[desk] session expired — polling stopped. Reload or sign in again to resume.',
          );
          warnedExpiredOnceRef.current = true;
        }
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      let all: DeskJob[] = json.jobs ?? [];
      // The list is light (no output/articles/…) — hydrate the one job the
      // card body actually renders: the session's latest job, once done.
      // Merge before setJobs so the UI never sees a done job without its
      // report (that state reads as "결과 비어있음" and flashes the retry
      // banner). If the detail fetch fails we keep the light row; the next
      // realtime tick retries.
      const target = all.find(
        (j) => new Date(j.created_at).getTime() >= sessionStart,
      );
      if (target && target.status === 'done') {
        const cached = detailCacheRef.current.get(target.id);
        if (cached && cached.updated_at === target.updated_at) {
          all = all.map((j) => (j.id === target.id ? cached : j));
        } else {
          try {
            const detailRes = await fetch(`/api/desk/jobs/${target.id}`, {
              cache: 'no-store',
            });
            if (detailRes.ok) {
              const detail: DeskJob | undefined = (await detailRes.json()).job;
              if (detail) {
                detailCacheRef.current.set(detail.id, detail);
                all = all.map((j) => (j.id === detail.id ? detail : j));
              }
            }
          } catch {
            // keep the light row — next refresh retries
          }
        }
      }
      // Surface every job the API returns — it already caps at the 20 most
      // recent, so past runs persist across refresh/relogin (natural rotation
      // drops the oldest). No client-side session cutoff: a finished report
      // must stay visible after the tab reloads.
      setJobs(all);
      stopOnExpiredRef.current = false;
      warnedExpiredOnceRef.current = false;
    } catch {
      // ignore — realtime or next refresh will catch up
    }
  }, [user, sessionStart]);

  // On user change (login/logout/relogin) clear the panel and re-arm the auth
  // gate so a re-login wakes polling back up. The next refresh() repopulates
  // from the API — no session cutoff, so the new user's own past jobs show.
  useEffect(() => {
    const uid = user?.id ?? null;
    if (lastUserIdRef.current !== uid) {
      lastUserIdRef.current = uid;
      stopOnExpiredRef.current = false;
      warnedExpiredOnceRef.current = false;
      setJobs([]);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void refresh();
  }, [refresh]);

  // Realtime subscription on desk_jobs row changes — provider keeps the panel
  // current even when the user is on another page.
  useEffect(() => {
    if (!user) {
      if (channelRef.current) {
        const supabase = createClient();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }
    const supabase = createClient();
    const ch = supabase
      .channel(`desk-jobs-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'desk_jobs' },
        () => {
          void refresh();
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      if (channelRef.current === ch) channelRef.current = null;
    };
  }, [user, refresh]);

  const cancelJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/desk/jobs/${id}/cancel`, { method: 'POST' });
      // Optimistic flag flip — Realtime will sync the actual status flip in
      // a moment, but flipping cancel_requested locally lets the button show
      // the requested state instantly.
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, cancel_requested: true } : j)),
      );
    } catch {
      // ignore — user can retry
    }
  }, []);

  // Session-scoped: only jobs created since this provider mounted are eligible
  // to be `latestJob`. `jobs` is ordered newest-first, so find() returns the
  // most recent in-session job (or null → idle UI on a fresh visit). Old
  // completed jobs stay in `jobs` for history but never surface here.
  const latestJob = useMemo(
    () =>
      jobs.find(
        (j) => new Date(j.created_at).getTime() >= sessionStart,
      ) ?? null,
    [jobs, sessionStart],
  );
  const isWorking = jobs.some((j) => ACTIVE.includes(j.status));

  return (
    <DeskJobCtx.Provider
      value={{ jobs, isWorking, latestJob, refresh, cancelJob }}
    >
      {children}
    </DeskJobCtx.Provider>
  );
}
