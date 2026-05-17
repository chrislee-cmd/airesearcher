'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAuth } from './auth-provider';

export type VideoJobStatus = 'uploading' | 'indexing' | 'indexed' | 'analyzing' | 'done' | 'error';

export type VideoJob = {
  id: string;
  org_id: string;
  user_id: string;
  filename: string;
  size_bytes: number | null;
  storage_key: string;
  tl_asset_id: string | null;
  tl_indexed_asset_id: string | null;
  tl_index_id: string;
  status: VideoJobStatus;
  analysis: string | null;
  error_message: string | null;
  generation_id: string | null;
  credits_spent: number;
  created_at: string;
  updated_at: string;
};

type LocalUpload = { progress: number };

type Ctx = {
  jobs: VideoJob[];
  localUploads: Record<string, LocalUpload>;
  setUploadProgress: (tempId: string, pct: number) => void;
  clearUploadProgress: (tempId: string) => void;
  refreshJobs: () => Promise<void>;
  removeJob: (id: string) => void;
};

const VideoJobCtx = createContext<Ctx | null>(null);

export function useVideoJobs() {
  const v = useContext(VideoJobCtx);
  if (!v) throw new Error('useVideoJobs must be used inside <VideoJobProvider>');
  return v;
}

const ACTIVE_STATUSES: VideoJobStatus[] = ['uploading', 'indexing', 'analyzing'];
const POLL_INTERVAL_MS = 8_000;

export function VideoJobProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [localUploads, setLocalUploads] = useState<Record<string, LocalUpload>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshJobs = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/video/jobs');
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: VideoJob[] };
      setJobs(data.jobs ?? []);
    } catch {}
  }, [user]);

  // Poll active jobs individually to flip their status
  const pollActive = useCallback(async (activeJobs: VideoJob[]) => {
    await Promise.all(
      activeJobs
        .filter((j) => j.status === 'indexing' || j.status === 'analyzing')
        .map(async (j) => {
          try {
            await fetch(`/api/video/jobs/${j.id}/poll`, { method: 'POST' });
          } catch {}
        }),
    );
    // Refresh list after polling to pick up status changes
    await refreshJobs();
  }, [refreshJobs]);

  // Load jobs on mount and when user changes
  useEffect(() => {
    if (!user) { setJobs([]); return; }
    void refreshJobs();
  }, [user, refreshJobs]);

  // Set up polling when there are active jobs
  useEffect(() => {
    const active = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));
    if (active.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    if (pollingRef.current) return; // already polling
    pollingRef.current = setInterval(() => {
      void pollActive(jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)));
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobs, pollActive]);

  function setUploadProgress(tempId: string, pct: number) {
    setLocalUploads((prev) => ({ ...prev, [tempId]: { progress: pct } }));
  }

  function clearUploadProgress(tempId: string) {
    setLocalUploads((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
  }

  function removeJob(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  return (
    <VideoJobCtx.Provider
      value={{ jobs, localUploads, setUploadProgress, clearUploadProgress, refreshJobs, removeJob }}
    >
      {children}
    </VideoJobCtx.Provider>
  );
}
