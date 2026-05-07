'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ActiveProject = { id: string; name: string } | null;

type Ctx = {
  active: ActiveProject;
  projects: { id: string; name: string }[];
  setActive: (p: ActiveProject) => void;
};

const STORAGE_KEY = 'active_project:v1';
const ActiveProjectCtx = createContext<Ctx | null>(null);

export function ActiveProjectProvider({
  projects,
  children,
}: {
  projects: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const [active, setActiveState] = useState<ActiveProject>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActiveProject;
      if (parsed && projects.some((p) => p.id === parsed.id)) {
        setActiveState(parsed);
      } else if (parsed) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [projects]);

  const setActive = useCallback((p: ActiveProject) => {
    setActiveState(p);
    try {
      if (p) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({ active, projects, setActive }),
    [active, projects, setActive],
  );

  return <ActiveProjectCtx.Provider value={value}>{children}</ActiveProjectCtx.Provider>;
}

export function useActiveProject() {
  const ctx = useContext(ActiveProjectCtx);
  if (!ctx) {
    return { active: null, projects: [], setActive: () => {} } satisfies Ctx;
  }
  return ctx;
}

export function useActiveProjectId(): string | null {
  return useActiveProject().active?.id ?? null;
}
