'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// Interview V2 — client hook over /api/interviews/v2/projects.
//
// The spec sketched this with SWR, but SWR isn't a dependency in this
// repo (conservative reading of the spec — no new package for an XS
// change). The public surface is identical to the SWR sketch —
// { projects, error, create, rename, remove } — so the V2 widget shell
// consumes it the same way; internally it's a plain fetch + local cache
// with an explicit refetch after every mutation.
//
// 보관함 탭: 스펙은 탭 전환마다 `?archived=0|1` 를 다시 fetch 하는 형태로
// 스케치됐지만, 여기서는 `?archived=all` 한 번만 fetch 해 클라이언트에서
// active / archived 로 나눈다. 탭 전환이 즉각적이고 두 탭 카운트를 동시에
// 보여줄 수 있으며(스펙 UI 요구), API 는 여전히 0|1|all 셋 다 지원한다.

export type InterviewProject = {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectTab = 'active' | 'archived';

const ENDPOINT = '/api/interviews/v2/projects';

export function useInterviewV2Projects() {
  const [allProjects, setAllProjects] = useState<InterviewProject[]>([]);
  const [tab, setTab] = useState<ProjectTab>('active');
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mutate = useCallback(async () => {
    try {
      const res = await fetch(`${ENDPOINT}?archived=all`);
      if (!res.ok) throw new Error(`list_failed_${res.status}`);
      const j = (await res.json()) as { projects?: InterviewProject[] };
      setAllProjects(j.projects ?? []);
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

  const activeProjects = useMemo(
    () => allProjects.filter((p) => !p.archived_at),
    [allProjects],
  );
  const archivedProjects = useMemo(
    () => allProjects.filter((p) => p.archived_at),
    [allProjects],
  );
  const projects = tab === 'archived' ? archivedProjects : activeProjects;

  const create = useCallback(
    async (
      name: string,
      description?: string,
    ): Promise<{ project: InterviewProject | null; error?: string }> => {
      // Surface the real failure reason (RLS / org / network) back to the
      // caller instead of collapsing everything to null — a silent null left
      // users staring at "왜 안 되는지 모름". See hotfix/interview-v2-project-create-bug.
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          project?: InterviewProject;
          error?: string;
        };
        if (!res.ok) {
          return { project: null, error: j.error ?? `HTTP ${res.status}` };
        }
        await mutate();
        return { project: j.project ?? null };
      } catch (e) {
        return {
          project: null,
          error: e instanceof Error ? e.message : 'create_failed',
        };
      }
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

  const setArchived = useCallback(
    async (id: string, archived: boolean): Promise<void> => {
      await fetch(`${ENDPOINT}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      await mutate();
    },
    [mutate],
  );

  const archive = useCallback((id: string) => setArchived(id, true), [
    setArchived,
  ]);
  const unarchive = useCallback((id: string) => setArchived(id, false), [
    setArchived,
  ]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE' });
      await mutate();
    },
    [mutate],
  );

  return {
    projects,
    tab,
    setTab,
    activeCount: activeProjects.length,
    archivedCount: archivedProjects.length,
    error,
    isLoading,
    mutate,
    create,
    rename,
    archive,
    unarchive,
    remove,
  };
}
