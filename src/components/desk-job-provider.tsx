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
  phase?: 'expanding' | 'crawling' | 'summarizing';
  crawl_total?: number;
  crawl_done?: number;
  events: string[];
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

  const refresh = useCallback(async () => {
    if (!user) {
      setJobs([]);
      return;
    }
    try {
      const res = await fetch('/api/desk/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setJobs(json.jobs ?? []);
    } catch {
      // ignore — realtime or next refresh will catch up
    }
  }, [user]);

  useEffect(() => {
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
