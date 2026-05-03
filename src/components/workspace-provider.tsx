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
  clearAll: () => void;
  sendTo: (artifactId: string, target: FeatureKey) => string | null;
  targetsFor: (source: FeatureKey) => FeatureKey[];
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
    };
    setArtifacts((prev) => [next, ...prev]);
    return next;
  }, []);

  const removeArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
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
      clearAll,
      sendTo,
      targetsFor,
    }),
    [artifacts, isOpen, addArtifact, removeArtifact, clearAll, sendTo, targetsFor],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
