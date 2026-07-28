'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DeliverableRow } from '@/lib/artifacts/types';
import { MOVE_SUPPORTED } from './constants';
import { Pressable } from './pressable';

// Multi-select bulk bar (A4b). Move / Delete never depend on export format;
// bulk Export requires a non-empty intersection of export_formats across the
// selection. Export dispatch isn't wired in this PR (export-registry unmerged),
// so Export stays disabled with the CD hint; Move reuses /api/artifacts/assign
// per movable row; Delete is out of scope (disabled).

const PILL_ON = 'border-[1.5px] border-ink bg-paper shadow-memphis-sm';
const PILL_OFF = 'border-[1.5px] border-ink/20 bg-surface-disabled text-mute';

export function BulkBar({
  selected,
  hasOrg,
  projects,
  onClear,
  onChanged,
}: {
  selected: DeliverableRow[];
  hasOrg: boolean;
  projects: { id: string; name: string }[];
  onClear: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Library');
  const [moving, setMoving] = useState(false);

  const movable = selected.filter((r) => MOVE_SUPPORTED[r.feature]);
  const moveEnabled = hasOrg && projects.length > 0 && movable.length > 0 && !moving;

  // Export is enabled only when every selected row shares at least one format
  // (non-empty intersection). Even so, bulk export dispatch is not wired in
  // this PR, so the button stays disabled — this only drives the tooltip.
  const intersection = selected.reduce<Set<string> | null>((acc, r) => {
    const s = new Set(r.export_formats);
    if (acc === null) return s;
    return new Set([...acc].filter((f) => s.has(f)));
  }, null);
  const canExport = selected.length > 0 && (intersection?.size ?? 0) > 0;

  async function bulkMove(next: string | null) {
    setMoving(true);
    try {
      await Promise.all(
        movable.map((r) =>
          fetch('/api/artifacts/assign', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ feature: r.feature, id: r.id, project_id: next }),
          }),
        ),
      );
      onChanged();
      onClear();
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-panel border-2 border-ink bg-warning-bg px-3.5 py-2.5 shadow-memphis-md-amber">
      <span className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-xs border-[1.6px] border-ink bg-ink text-xs text-paper">
        ✓
      </span>
      <span className="text-lg font-extrabold text-ink">
        {t('bulk.selected', { count: selected.length })}
      </span>
      <span className="h-[18px] w-px bg-ink/20" />

      {/* Move to project — native <select> is DS-lint-allowed. */}
      <span
        className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-md font-bold text-ink ${
          moveEnabled ? PILL_ON : PILL_OFF
        }`}
      >
        📁
        <select
          aria-label={t('bulk.move')}
          disabled={!moveEnabled}
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            bulkMove(e.target.value === '__unfiled__' ? null : e.target.value);
          }}
          className="cursor-pointer border-0 bg-transparent text-md font-bold text-ink focus:outline-none disabled:cursor-not-allowed"
        >
          <option value="" disabled>
            {t('bulk.move')}
          </option>
          <option value="__unfiled__">{t('move.unfiled')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </span>

      <span
        title={canExport ? undefined : t('bulk.exportDisabled')}
        className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-md font-bold ${PILL_OFF}`}
      >
        ↓ {t('bulk.export')}
      </span>

      <span
        title={t('deleteUnavailable')}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-pill border-[1.5px] border-ink/20 bg-surface-disabled px-3 py-1.5 text-md font-bold text-mute"
      >
        🗑 {t('bulk.delete')}
      </span>

      <Pressable
        onPress={onClear}
        className="ml-auto cursor-pointer text-md font-semibold text-mute-soft"
      >
        {t('bulk.clear')}
      </Pressable>
    </div>
  );
}
