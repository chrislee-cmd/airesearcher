'use client';

import { useCallback, useEffect, useState } from 'react';

// Interview V2 — client hook over
// /api/interviews/v2/projects/[id]/trust-stats. Same plain-fetch shape as
// useInterviewV2Documents (no SWR in this repo); feeds the collapsible
// 신뢰도 (trust) panel under the file list with file / chunk / embed-rate
// counts.

export type InterviewV2TrustStats = {
  fileCount: number;
  chunkCount: number;
  // 0–1 fraction of documents whose index job reached 'done'.
  embedRate: number;
};

export function useInterviewV2TrustStats(projectId: string | null) {
  const [stats, setStats] = useState<InterviewV2TrustStats | null>(null);
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
      const j = (await res.json()) as Partial<InterviewV2TrustStats>;
      setStats({
        fileCount: j.fileCount ?? 0,
        chunkCount: j.chunkCount ?? 0,
        embedRate: j.embedRate ?? 1,
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
