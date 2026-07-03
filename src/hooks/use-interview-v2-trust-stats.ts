'use client';

import { useCallback, useEffect, useState } from 'react';

// Interview V2 — client hook over
// /api/interviews/v2/projects/[id]/trust-stats. Same plain-fetch shape as
// useInterviewV2Documents (no SWR dependency in this repo); feeds the
// static <TrustBadgeStrip /> under the file list. Returns null stats until
// the first fetch resolves so the strip can stay hidden while loading.

export type InterviewTrustStats = {
  file_count: number;
  chunk_count: number;
  embed_rate: number;
};

export function useInterviewV2TrustStats(projectId: string | null) {
  const [stats, setStats] = useState<InterviewTrustStats | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mutate = useCallback(async () => {
    if (!projectId) {
      setStats(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/interviews/v2/projects/${projectId}/trust-stats`,
      );
      if (!res.ok) throw new Error(`stats_failed_${res.status}`);
      const j = (await res.json()) as Partial<InterviewTrustStats>;
      setStats({
        file_count: j.file_count ?? 0,
        chunk_count: j.chunk_count ?? 0,
        embed_rate: j.embed_rate ?? 1,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('stats_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void mutate();
  }, [mutate]);

  return { stats, error, isLoading, mutate };
}
