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
import type { FeatureKey } from '@/lib/features';
import {
  type DbBackedFeature,
  type WorkspaceArtifact,
  type WorkspaceFolder,
  prefillKey,
  SEND_TO_MAP,
} from '@/lib/workspace';
import { useActiveProject } from './active-project-provider';

export type DragInfo = {
  artifactId: string;
  sourceFeature: FeatureKey;
};

// Filter applied to the artifact list. Mirrors ProjectFilter on the server.
//   - 'active': artifacts in the currently-selected project (from
//                ActiveProjectProvider). Falls back to 'unfiled' if no
//                project is active.
//   - 'all':    every artifact in the org.
//   - 'unfiled': artifacts with project_id = null.
//   - <uuid>:   artifacts in a specific project (overrides active).
export type WorkspaceScope = 'active' | 'all' | 'unfiled' | string;

type Ctx = {
  artifacts: WorkspaceArtifact[];
  loading: boolean;
  error: string | null;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  scope: WorkspaceScope;
  setScope: (s: WorkspaceScope) => void;
  // The project_id actually being displayed (resolved from scope +
  // active project). null means "unfiled" or "all".
  resolvedProjectId: string | null;
  resolvedKind: 'project' | 'unfiled' | 'all';
  // Selected folder *within* the resolved project. null = project root
  // (artifacts whose folder_id IS NULL). Has no effect when
  // resolvedKind ≠ 'project'.
  selectedFolderId: string | null;
  setSelectedFolderId: (id: string | null) => void;
  // Folders under the resolved project, flat. Empty when not in a project.
  folders: WorkspaceFolder[];
  // Create / rename / move / delete a folder. Each refreshes the folder
  // list on success; artifact list is unaffected except for delete which
  // also refetches artifacts (their folder_id may have been cleared by
  // the FK ON DELETE SET NULL).
  createFolder: (name: string, parentFolderId: string | null) => Promise<WorkspaceFolder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  // Move a single artifact into a folder (or to project root with null).
  setFolderId: (artifact: WorkspaceArtifact, folderId: string | null) => Promise<void>;
  // Refetch the artifact list. Call after a mutation (assign, delete).
  refresh: () => Promise<void>;
  // Legacy no-op kept so generators that used to push completed jobs into
  // the panel (transcripts/desk/interview/reports/recruiting/scheduler)
  // continue to compile. The DB is now the source of truth — those jobs
  // already persist there, and the next `/api/workspace/artifacts` fetch
  // surfaces them automatically. Safe to delete callers in a follow-up PR.
  addArtifact: (...args: unknown[]) => void;
  removeArtifact: (artifact: WorkspaceArtifact) => Promise<void>;
  removeArtifacts: (artifacts: WorkspaceArtifact[]) => Promise<void>;
  setProjectId: (
    artifact: WorkspaceArtifact,
    projectId: string | null,
  ) => Promise<void>;
  // Lazy content fetch — used by view/copy/download/send-to handlers.
  // Cached in-memory for the panel session so repeated clicks don't re-hit.
  fetchContent: (
    artifact: WorkspaceArtifact,
  ) => Promise<{ content: string; kind: 'html' | 'markdown' | 'text' } | null>;
  // Id-based for backwards-compat with the sidebar's drag-and-drop flow,
  // which only carries artifact ids over dataTransfer. Returns null if the
  // id isn't in the current artifact list (cross-scope drag from stale
  // state — caller should bail out and reopen panel for fresh data).
  sendTo: (artifactId: string, target: FeatureKey) => Promise<string | null>;
  sendMany: (
    artifactIds: string[],
    target: FeatureKey,
  ) => Promise<string | null>;
  targetsFor: (source: FeatureKey) => FeatureKey[];
  dragging: DragInfo | null;
  setDragging: (info: DragInfo | null) => void;
};

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { active } = useActiveProject();
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [scope, setScope] = useState<WorkspaceScope>('active');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragInfo | null>(null);

  // (feature,id) → content cache. Drops on page nav (in-memory only).
  const contentCacheRef = useRef<Map<string, { content: string; kind: 'html' | 'markdown' | 'text' }>>(
    new Map(),
  );

  // Resolve scope → server query param.
  const { resolvedProjectId, resolvedKind, queryParam } = useMemo(() => {
    if (scope === 'all') {
      return { resolvedProjectId: null, resolvedKind: 'all' as const, queryParam: 'all' };
    }
    if (scope === 'unfiled') {
      return { resolvedProjectId: null, resolvedKind: 'unfiled' as const, queryParam: 'unfiled' };
    }
    if (scope === 'active') {
      if (active?.id) {
        return {
          resolvedProjectId: active.id,
          resolvedKind: 'project' as const,
          queryParam: active.id,
        };
      }
      return { resolvedProjectId: null, resolvedKind: 'unfiled' as const, queryParam: 'unfiled' };
    }
    // Explicit project id
    return { resolvedProjectId: scope, resolvedKind: 'project' as const, queryParam: scope };
  }, [scope, active]);

  // Folder filter is meaningful only when scope resolves to a project. In
  // 'all' / 'unfiled' modes we deliberately ignore selectedFolderId so the
  // user's folder selection survives a scope flip but doesn't leak into a
  // query that wouldn't match anything.
  const folderQueryParam =
    resolvedKind === 'project'
      ? selectedFolderId === null
        ? null
        : selectedFolderId
      : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        resolvedKind === 'project' && folderQueryParam !== null
          ? `/api/workspace/artifacts?project=${encodeURIComponent(queryParam)}&folder=${encodeURIComponent(folderQueryParam)}`
          : `/api/workspace/artifacts?project=${encodeURIComponent(queryParam)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        setError('list_failed');
        return;
      }
      const json = await res.json();
      const list = (json.artifacts ?? []) as WorkspaceArtifact[];
      setArtifacts(list);
    } catch {
      setError('network_error');
    } finally {
      setLoading(false);
    }
  }, [queryParam, resolvedKind, folderQueryParam]);

  // Folder list is only meaningful for project scope. We refetch on
  // resolvedProjectId change; for other scopes we clear it.
  const refreshFolders = useCallback(async () => {
    if (resolvedKind !== 'project' || !resolvedProjectId) {
      setFolders([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/workspace/folders?project=${encodeURIComponent(resolvedProjectId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const json = await res.json();
      // Server returns snake_case; remap.
      type Row = {
        id: string;
        project_id: string;
        parent_folder_id: string | null;
        name: string;
        created_at: string;
        updated_at: string;
      };
      const rows = (json.folders ?? []) as Row[];
      setFolders(
        rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          parentFolderId: r.parent_folder_id,
          name: r.name,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      );
    } catch {
      /* swallow — folder pane will show empty */
    }
  }, [resolvedKind, resolvedProjectId]);

  // Auto-fetch on open + scope change. Closed panel doesn't poll — the
  // user's next open will re-fetch fresh data.
  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    void refreshFolders();
  }, [isOpen, refresh, refreshFolders]);

  // Switching project (or leaving project scope) invalidates the folder
  // selection — keep it consistent so the panel never queries a folder
  // that lives in a different project.
  useEffect(() => {
    setSelectedFolderId(null);
  }, [resolvedProjectId, resolvedKind]);

  const fetchContent = useCallback<Ctx['fetchContent']>(async (a) => {
    const key = `${a.dbFeature}:${a.dbId}`;
    const cached = contentCacheRef.current.get(key);
    if (cached) return cached;
    try {
      const res = await fetch('/api/workspace/content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature: a.dbFeature, id: a.dbId }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { content: string; kind: 'html' | 'markdown' | 'text' };
      contentCacheRef.current.set(key, json);
      return json;
    } catch {
      return null;
    }
  }, []);

  const addArtifact = useCallback<Ctx['addArtifact']>(() => {
    // no-op — see Ctx['addArtifact'] comment
  }, []);

  const createFolder = useCallback<Ctx['createFolder']>(async (name, parentFolderId) => {
    if (resolvedKind !== 'project' || !resolvedProjectId) return null;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: resolvedProjectId,
          name,
          parent_folder_id: parentFolderId,
        }),
      });
      if (!res.ok) return null;
      const row = (await res.json()) as {
        id: string;
        project_id: string;
        parent_folder_id: string | null;
        name: string;
        created_at: string;
        updated_at: string;
      };
      const folder: WorkspaceFolder = {
        id: row.id,
        projectId: row.project_id,
        parentFolderId: row.parent_folder_id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      return folder;
    } catch {
      return null;
    }
  }, [resolvedKind, resolvedProjectId]);

  const renameFolder = useCallback<Ctx['renameFolder']>(async (id, name) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    try {
      await fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {
      void refreshFolders();
    }
  }, [refreshFolders]);

  const moveFolder = useCallback<Ctx['moveFolder']>(async (id, parentFolderId) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, parentFolderId } : f)),
    );
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parent_folder_id: parentFolderId }),
      });
      if (!res.ok) void refreshFolders();
    } catch {
      void refreshFolders();
    }
  }, [refreshFolders]);

  const deleteFolder = useCallback<Ctx['deleteFolder']>(async (id) => {
    setFolders((prev) => prev.filter((f) => f.id !== id && f.parentFolderId !== id));
    if (selectedFolderId === id) setSelectedFolderId(null);
    try {
      await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    // Artifacts may have lost their folder_id via FK ON DELETE SET NULL,
    // and subfolders may have been cascade-deleted. Refetch both.
    void refresh();
    void refreshFolders();
  }, [selectedFolderId, refresh, refreshFolders]);

  const setFolderId = useCallback<Ctx['setFolderId']>(async (artifact, folderId) => {
    setArtifacts((prev) =>
      prev.map((a) => (a.id === artifact.id ? { ...a, folderId } : a)),
    );
    try {
      await fetch('/api/artifacts/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          feature: artifact.dbFeature,
          id: artifact.dbId,
          folder_id: folderId,
        }),
      });
    } catch {
      void refresh();
    }
  }, [refresh]);

  const setProjectId = useCallback<Ctx['setProjectId']>(async (artifact, projectId) => {
    // Optimistic update + server write. Failure rolls back via refresh().
    setArtifacts((prev) =>
      prev.map((a) =>
        a.id === artifact.id ? { ...a, projectId: projectId } : a,
      ),
    );
    try {
      await fetch('/api/artifacts/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          feature: artifact.dbFeature,
          id: artifact.dbId,
          project_id: projectId,
        }),
      });
    } catch {
      // Re-fetch to get authoritative state on network failure
      void refresh();
    }
  }, [refresh]);

  // "Remove" from the workspace means unassigning from the current scope
  // (project → unfiled, or unfiled → still unfiled). We never delete the
  // underlying DB row from here — that lives in the source feature.
  const removeArtifact = useCallback<Ctx['removeArtifact']>(async (artifact) => {
    if (resolvedKind === 'all' || resolvedKind === 'unfiled') {
      // No-op in 'all'/'unfiled' scope — there's nothing to remove from.
      // The panel hides the delete action in these scopes; this guard is
      // belt-and-suspenders.
      return;
    }
    await setProjectId(artifact, null);
  }, [resolvedKind, setProjectId]);

  const removeArtifacts = useCallback<Ctx['removeArtifacts']>(async (list) => {
    if (resolvedKind === 'all' || resolvedKind === 'unfiled') return;
    await Promise.all(list.map((a) => setProjectId(a, null)));
  }, [resolvedKind, setProjectId]);

  const sendTo = useCallback<Ctx['sendTo']>(async (artifactId, target) => {
    const a = artifacts.find((x) => x.id === artifactId);
    if (!a) return null;
    const c = await fetchContent(a);
    if (!c) return null;
    try {
      sessionStorage.setItem(prefillKey(target), c.content);
    } catch {
      /* ignore quota */
    }
    return `/${target}`;
  }, [artifacts, fetchContent]);

  const sendMany = useCallback<Ctx['sendMany']>(async (ids, target) => {
    if (ids.length === 0) return null;
    const lookup = new Map(artifacts.map((a) => [a.id, a] as const));
    const list = ids.map((id) => lookup.get(id)).filter((a): a is WorkspaceArtifact => !!a);
    if (list.length === 0) return null;
    const contents = await Promise.all(
      list.map(async (a) => {
        const c = await fetchContent(a);
        return c ? { title: a.title, content: c.content } : null;
      }),
    );
    const ok = contents.filter((x): x is { title: string; content: string } => !!x);
    if (ok.length === 0) return null;
    const concatenated = ok.map((x) => `# ${x.title}\n\n${x.content}`).join('\n\n---\n\n');
    try {
      sessionStorage.setItem(prefillKey(target), concatenated);
    } catch {
      /* ignore */
    }
    return `/${target}`;
  }, [artifacts, fetchContent]);

  const targetsFor = useCallback<Ctx['targetsFor']>((source) => {
    return SEND_TO_MAP[source] ?? [];
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      artifacts,
      loading,
      error,
      isOpen,
      setOpen,
      scope,
      setScope,
      resolvedProjectId,
      resolvedKind,
      selectedFolderId,
      setSelectedFolderId,
      folders,
      createFolder,
      renameFolder,
      moveFolder,
      deleteFolder,
      setFolderId,
      refresh,
      addArtifact,
      removeArtifact,
      removeArtifacts,
      setProjectId,
      fetchContent,
      sendTo,
      sendMany,
      targetsFor,
      dragging,
      setDragging,
    }),
    [
      artifacts,
      loading,
      error,
      isOpen,
      scope,
      resolvedProjectId,
      resolvedKind,
      selectedFolderId,
      folders,
      createFolder,
      renameFolder,
      moveFolder,
      deleteFolder,
      setFolderId,
      refresh,
      addArtifact,
      removeArtifact,
      removeArtifacts,
      setProjectId,
      fetchContent,
      sendTo,
      sendMany,
      targetsFor,
      dragging,
    ],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}

// Re-export for components that need to type-narrow on the artifact shape.
export type { WorkspaceArtifact, DbBackedFeature };
