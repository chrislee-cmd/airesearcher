'use client';

import { useCallback, useEffect, useState } from 'react';

// Interview V2 — client hook over /api/interviews/v2/projects.
//
// The spec sketched this with SWR, but SWR isn't a dependency in this
// repo (conservative reading of the spec — no new package for an XS
// change). The public surface is identical to the SWR sketch —
// { projects, error, create, rename, remove } — so the V2 widget shell
// consumes it the same way; internally it's a plain fetch + local cache
// with an explicit refetch after every mutation.

export type InterviewProject = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

const ENDPOINT = '/api/interviews/v2/projects';

export function useInterviewV2Projects() {
  const [projects, setProjects] = useState<InterviewProject[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mutate = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) throw new Error(`list_failed_${res.status}`);
      const j = (await res.json()) as { projects?: InterviewProject[] };
      setProjects(j.projects ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('list_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void mutate();
  }, [mutate]);

  const create = useCallback(
    async (name: string, description?: string): Promise<InterviewProject | null> => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const j = (await res.json().catch(() => ({}))) as { project?: InterviewProject };
      await mutate();
      return j.project ?? null;
    },
    [mutate],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      await fetch(`${ENDPOINT}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await mutate();
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE' });
      await mutate();
    },
    [mutate],
  );

  return { projects, error, isLoading, mutate, create, rename, remove };
}
