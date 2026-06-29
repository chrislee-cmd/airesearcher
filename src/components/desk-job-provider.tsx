'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from './auth-provider';
import type { DeskArticle, DeskSourceId } from '@/lib/desk-sources';

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
  data: { label: string; value: number }[];
};

export type DeskAnalytics = {
  charts: DeskChart[];
};

export type DeskJob = {
  id: string;
  keywords: string[];
  sources: DeskSourceId[];
  locale: string;
  date_from: string | null;
  date_to: string | null;
  status: DeskJobStatus;
  progress: DeskJobProgress;
  similar_keywords: string[];
  output: string | null;
  articles: DeskArticle[] | null;
  analytics: DeskAnalytics | null;
  research_questions: DeskResearchQuestion[] | null;
  claims: DeskClaim[] | null;
  rq_answers: DeskRqAnswer[] | null;
  skipped: { source: DeskSourceId; missing: string }[] | null;
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
  /** Most recent job for the current user — what the screen renders. */
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
  // Session boundary: only jobs created at/after this moment are surfaced.
  // Reset on mount (refresh) and on user change (login/logout/relogin) so
  // past runs never leak into a fresh session.
  const sessionStartRef = useRef<string>(new Date().toISOString());
  const lastUserIdRef = useRef<string | null>(null);

  // Auth health gate. The realtime subscription on `desk_jobs` (below)
  // fires `refresh()` on every row change — an active scraping job can
  // emit dozens of progress events per minute. If the session expired
  // we'd hammer `/api/desk/jobs` with 401s once per event. Flip true on
  // the first 401, skip every subsequent fetch, and reset on user
  // identity change (re-login) or the next healthy response.
  const stopOnExpiredRef = useRef(false);
  const warnedExpiredOnceRef = useRef(false);

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
      const all: DeskJob[] = json.jobs ?? [];
      const cutoff = sessionStartRef.current;
      setJobs(all.filter((j) => j.created_at >= cutoff));
      stopOnExpiredRef.current = false;
      warnedExpiredOnceRef.current = false;
    } catch {
      // ignore — realtime or next refresh will catch up
    }
  }, [user]);

  // Reset the session cutoff whenever the signed-in user changes.
  // Also re-arm the auth gate so a re-login wakes polling back up.
  useEffect(() => {
    const uid = user?.id ?? null;
    if (lastUserIdRef.current !== uid) {
      sessionStartRef.current = new Date().toISOString();
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

  const latestJob = jobs[0] ?? null;
  const isWorking = jobs.some((j) => ACTIVE.includes(j.status));

  return (
    <DeskJobCtx.Provider
      value={{ jobs, isWorking, latestJob, refresh, cancelJob }}
    >
      {children}
    </DeskJobCtx.Provider>
  );
}
