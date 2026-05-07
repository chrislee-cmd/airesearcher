'use client';

import { useEffect } from 'react';
import { useActiveProject } from './active-project-provider';

export function ActiveProjectSync({ id, name }: { id: string; name: string }) {
  const { active, setActive } = useActiveProject();
  useEffect(() => {
    if (active?.id !== id) setActive({ id, name });
  }, [id, name, active?.id, setActive]);
  return null;
}
