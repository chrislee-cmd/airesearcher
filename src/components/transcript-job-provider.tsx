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

export type TranscriptJobStatus =
  | 'queued'
  | 'submitting'
  | 'transcribing'
  | 'done'
  | 'error';

export type TranscriptJob = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  speakers_count: number | null;
  status: TranscriptJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type Ctx = {
  jobs: TranscriptJob[];
  isWorking: boolean;
  /** Local upload progress is tracked separately, not in DB. */
  localUploads: Record<string, number>; // tempId → 0..100
  refreshJobs: () => Promise<void>;
  upsertJob: (job: TranscriptJob) => void;
  removeJob: (id: string) => void;
  setUploadProgress: (tempId: string, pct: number) => void;
  clearUploadProgress: (tempId: string) => void;
};

const TranscriptJobContext = createContext<Ctx | null>(null);

export function useTranscriptJobs() {
  const v = useContext(TranscriptJobContext);
  if (!v) {
    throw new Error('useTranscriptJobs must be used inside TranscriptJobProvider');
  }
  return v;
}

const ACTIVE_STATUSES: TranscriptJobStatus[] = [
  'queued',
  'submitting',
  'transcribing',
];

export function TranscriptJobProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<TranscriptJob[]>([]);
  const [localUploads, setLocalUploads] = useState<Record<string, number>>({});
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>['channel']
  > | null>(null);

  const refreshJobs = useCallback(async () => {
    if (!user) {
      setJobs([]);
      return;
    }
    try {
      const res = await fetch('/api/transcripts/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setJobs(json.jobs ?? []);
    } catch {
      // ignore — next refresh will retry
    }
  }, [user]);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  // Realtime subscription. Updates land here when the webhook flips a job
  // to 'done' / 'error' on the server.
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
      .channel(`transcript-jobs-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transcript_jobs',
        },
        () => {
          void refreshJobs();
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      if (channelRef.current === ch) channelRef.current = null;
    };
  }, [user, refreshJobs]);

  const upsertJob = useCallback((job: TranscriptJob) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === job.id);
      if (idx === -1) return [job, ...prev];
      const next = [...prev];
      next[idx] = job;
      return next;
    });
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const setUploadProgress = useCallback((tempId: string, pct: number) => {
    setLocalUploads((prev) => ({ ...prev, [tempId]: pct }));
  }, []);
  const clearUploadProgress = useCallback((tempId: string) => {
    setLocalUploads((prev) => {
      const { [tempId]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const isWorking =
    Object.keys(localUploads).length > 0 ||
    jobs.some((j) => ACTIVE_STATUSES.includes(j.status));

  const value: Ctx = {
    jobs,
    isWorking,
    localUploads,
    refreshJobs,
    upsertJob,
    removeJob,
    setUploadProgress,
    clearUploadProgress,
  };

  return (
    <TranscriptJobContext.Provider value={value}>
      {children}
    </TranscriptJobContext.Provider>
  );
}
