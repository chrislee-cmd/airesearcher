'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';

type Props = {
  feature: 'report' | 'interview' | 'transcript' | 'desk' | 'scheduler';
  id: string;
  currentProjectId: string;
  projects: { id: string; name: string }[];
  unfiledLabel: string;
};

export function ArtifactAssignMenu({
  feature,
  id,
  currentProjectId,
  projects,
  unfiledLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === '__unfiled__' ? null : e.target.value;
    if ((next ?? '') === currentProjectId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/artifacts/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature, id, project_id: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex items-center gap-2">
      <select
        value={currentProjectId || '__unfiled__'}
        onChange={onChange}
        disabled={pending}
        className="border border-line bg-paper px-2 py-1 text-[11px] text-mute-soft transition-colors hover:text-ink-2 [border-radius:14px] disabled:opacity-50"
      >
        <option value="__unfiled__">{unfiledLabel}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <span className="text-[10.5px] text-amore">{error}</span>}
    </span>
  );
}
