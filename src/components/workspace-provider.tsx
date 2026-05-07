'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { FeatureKey } from '@/lib/features';
import {
  type WorkspaceArtifact,
  prefillKey,
  SEND_TO_MAP,
} from '@/lib/workspace';

const STORAGE_KEY = 'workspace:artifacts:v1';

export type DragInfo = {
  artifactId: string;
  sourceFeature: FeatureKey;
};

type Ctx = {
  artifacts: WorkspaceArtifact[];
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  addArtifact: (
    a: Omit<WorkspaceArtifact, 'id' | 'createdAt'> & {
      id?: string;
      createdAt?: number;
    },
  ) => WorkspaceArtifact;
  removeArtifact: (id: string) => void;
  removeArtifacts: (ids: string[]) => void;
  setProjectId: (artifactId: string, projectId: string | null) => void;
  clearAll: () => void;
  sendTo: (artifactId: string, target: FeatureKey) => string | null;
  sendMany: (artifactIds: string[], target: FeatureKey) => string | null;
  targetsFor: (source: FeatureKey) => FeatureKey[];
  // Drag state — set by WorkspacePanel when an artifact starts dragging,
  // read by Sidebar to highlight compatible drop targets.
  dragging: DragInfo | null;
  setDragging: (info: DragInfo | null) => void;
  // Drives the trigger-button pulse + new-row flash.
  lastAddedId: string | null;
  lastAddedAt: number | null;
};

const WorkspaceCtx = createContext<Ctx | null>(null);

function readStorage(): WorkspaceArtifact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkspaceArtifact[];
  } catch {
    return [];
  }
}

function writeStorage(items: WorkspaceArtifact[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota or serialization failure — ignore
  }
}

function makeId() {
  return `wa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState<DragInfo | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [lastAddedAt, setLastAddedAt] = useState<number | null>(null);

  useEffect(() => {
    setArtifacts(readStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(artifacts);
  }, [artifacts, hydrated]);

  // Cross-tab sync.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setArtifacts(readStorage());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const addArtifact: Ctx['addArtifact'] = useCallback((input) => {
    const next: WorkspaceArtifact = {
      id: input.id ?? makeId(),
      featureKey: input.featureKey,
      title: input.title,
      content: input.content,
      createdAt: input.createdAt ?? Date.now(),
      dbFeature: input.dbFeature,
      dbId: input.dbId,
      projectId: input.projectId ?? null,
    };
    let isNew = true;
    setArtifacts((prev) => {
      // Upsert by id — repeat calls (e.g. scheduler autosave) update
      // title/content/projectId in place rather than spamming new rows.
      const idx = prev.findIndex((a) => a.id === next.id);
      if (idx >= 0) {
        isNew = false;
        const merged: WorkspaceArtifact = {
          ...prev[idx],
          title: next.title,
          content: next.content,
          dbFeature: next.dbFeature ?? prev[idx].dbFeature,
          dbId: next.dbId ?? prev[idx].dbId,
          // Preserve projectId set locally by the modal picker. Fall back
          // to whatever the caller passed in.
          projectId: prev[idx].projectId ?? next.projectId ?? null,
        };
        const copy = prev.slice();
        copy[idx] = merged;
        return copy;
      }
      return [next, ...prev];
    });
    if (isNew) {
      setLastAddedId(next.id);
      setLastAddedAt(Date.now());
    }
    return next;
  }, []);

  const removeArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeArtifacts = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setArtifacts((prev) => prev.filter((a) => !set.has(a.id)));
  }, []);

  const setProjectId = useCallback<Ctx['setProjectId']>((artifactId, projectId) => {
    setArtifacts((prev) =>
      prev.map((a) => (a.id === artifactId ? { ...a, projectId } : a)),
    );
  }, []);

  const clearAll = useCallback(() => setArtifacts([]), []);

  const sendTo = useCallback<Ctx['sendTo']>(
    (artifactId, target) => {
      const a = artifacts.find((x) => x.id === artifactId);
      if (!a) return null;
      try {
        sessionStorage.setItem(prefillKey(target), a.content);
      } catch {
        // ignore
      }
      return `/${target}`;
    },
    [artifacts],
  );

  const sendMany = useCallback<Ctx['sendMany']>(
    (artifactIds, target) => {
      // Preserve panel order (newest-first) so concatenation is predictable.
      const lookup = new Map(artifacts.map((a) => [a.id, a] as const));
      const picked = artifactIds
        .map((id) => lookup.get(id))
        .filter((a): a is WorkspaceArtifact => !!a);
      if (picked.length === 0) return null;
      const concatenated = picked
        .map((a) => `# ${a.title}\n\n${a.content}`)
        .join('\n\n---\n\n');
      try {
        sessionStorage.setItem(prefillKey(target), concatenated);
      } catch {
        // ignore
      }
      return `/${target}`;
    },
    [artifacts],
  );

  const targetsFor = useCallback<Ctx['targetsFor']>((source) => {
    return SEND_TO_MAP[source] ?? [];
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      artifacts,
      isOpen,
      setOpen,
      addArtifact,
      removeArtifact,
      removeArtifacts,
      setProjectId,
      clearAll,
      sendTo,
      sendMany,
      targetsFor,
      dragging,
      setDragging,
      lastAddedId,
      lastAddedAt,
    }),
    [
      artifacts,
      isOpen,
      addArtifact,
      removeArtifact,
      removeArtifacts,
      setProjectId,
      clearAll,
      sendTo,
      sendMany,
      targetsFor,
      dragging,
      lastAddedId,
      lastAddedAt,
    ],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
