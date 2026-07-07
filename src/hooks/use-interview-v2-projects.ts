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
  tags: string[];
  // 프로젝트에 속한 인터뷰 문서 수 (서버 aggregate). 목록 카드의 "인터뷰 N개".
  // 구 응답/생성 직후엔 없을 수 있어 방어적으로 0 정규화한다.
  document_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** org 태그 유니버스 원소 — 자동완성/필터 chip row 용 (사용 빈도순). */
export type TagCount = { tag: string; count: number };

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
      // tags 를 항상 배열로, document_count 를 항상 숫자로 정규화
      // (DB default '{}' → [], count 누락 → 0, 방어적).
      setAllProjects(
        (j.projects ?? []).map((p) => ({
          ...p,
          tags: p.tags ?? [],
          document_count: p.document_count ?? 0,
        })),
      );
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

  // org 태그 유니버스 — 자동완성 제안 + 필터 chip row 의 소스.
  // 파편화 방지를 위해 대소문자 무시로 집계하되 first-seen 원본 표기를 유지.
  // 빈도순(desc) → 동률은 가나다/알파벳 순. 모든(활성+보관) 프로젝트 기준이라
  // 탭 전환에도 필터 chip 세트가 안정적이다.
  const allTags = useMemo<TagCount[]>(() => {
    const counts = new Map<string, TagCount>();
    for (const p of allProjects) {
      for (const raw of p.tags ?? []) {
        const key = raw.trim().toLowerCase();
        if (!key) continue;
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { tag: raw, count: 1 });
      }
    }
    return [...counts.values()].sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
    );
  }, [allProjects]);

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

  // 편집 모달용 — 이름·설명·태그를 한 PATCH 로 통째 저장 (부분 전송). 카드에서
  // 인라인 태그 편집기를 걷어낸 뒤, 태그 편집은 이 경로로만 이뤄진다. PATCH 는
  // 셋을 한 번에 받으므로 (route [id] PatchBody) 왕복 1회. 저장 후 목록 refetch.
  const update = useCallback(
    async (
      id: string,
      patch: { name?: string; description?: string | null; tags?: string[] },
    ): Promise<void> => {
      const res = await fetch(`${ENDPOINT}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`update_failed_${res.status}`);
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

  // 태그 통째 교체 (부분 연산 X). 서버가 trim/중복제거/≤10개/≤20자 재검증한다.
  //
  // 낙관적 업데이트: 전체 리스트 refetch(`await mutate()`) 를 기다리지 않고
  // **해당 프로젝트 row 만 즉시 로컬 갱신**한다 → chip 이 곧바로 등장(빈 박스 0).
  // editor 가 이미 서버와 동일 규칙(trim·중복제거·≤10·≤20)으로 선제 정규화하므로
  // 성공 시 refetch 불필요. 실패하면 이전 tags 로 롤백하고 정합용으로만 refetch
  // 한 뒤 throw — caller(project-list)가 잡아 "태그 저장 실패" 토스트를 띄운다.
  const setTags = useCallback(
    async (id: string, tags: string[]): Promise<void> => {
      // 이전 tags 를 캡처하며 낙관적 갱신 (updater 는 확실히 호출되고, prevTags 는
      // await 이후 catch 에서만 읽으므로 이 시점엔 채워져 있다).
      let prevTags: string[] | null = null;
      setAllProjects((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          prevTags = p.tags;
          return { ...p, tags };
        }),
      );
      try {
        const res = await fetch(`${ENDPOINT}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags }),
        });
        if (!res.ok) throw new Error(`tags_failed_${res.status}`);
      } catch (e) {
        // 롤백 — 캡처한 이전 tags 로 복원.
        if (prevTags !== null) {
          const restore = prevTags;
          setAllProjects((prev) =>
            prev.map((p) => (p.id === id ? { ...p, tags: restore } : p)),
          );
        }
        // 서버 실제 상태와 재동기화 (백그라운드, 비차단).
        void mutate();
        throw e instanceof Error ? e : new Error('tags_failed');
      }
    },
    [mutate],
  );

  return {
    projects,
    tab,
    setTab,
    activeCount: activeProjects.length,
    archivedCount: archivedProjects.length,
    allTags,
    error,
    isLoading,
    mutate,
    create,
    rename,
    update,
    archive,
    unarchive,
    remove,
    setTags,
  };
}
