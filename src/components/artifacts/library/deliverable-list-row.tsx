'use client';

import { useTranslations } from 'next-intl';
import type { DeliverableRow } from '@/lib/artifacts/types';
import { FEATURE_ICON, FEATURE_TONE_BG } from './constants';
import { formatProgress, formatUpdated } from './format';
import { SelectBox } from './pressable';
import { StatusBadge } from './status-badge';
import { RowActions } from './row-actions';

// One list row — receives a single DeliverableRow and nothing else feature-
// specific. Identity is the pastel tile + glyph; status is the shared badge.
// Geometry (GEOMETRY §A): row pad 12/20, 34px tile, status 120 / updated 104 /
// action 214 fixed columns.

export function DeliverableListRow({
  row,
  selected,
  onToggleSelect,
  hasOrg,
  projects,
  onChanged,
}: {
  row: DeliverableRow;
  selected: boolean;
  onToggleSelect: () => void;
  hasOrg: boolean;
  projects: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const t = useTranslations('Library');
  const pct = formatProgress(row.progress);
  const metaItems = pct ? [...row.meta_display, pct] : row.meta_display;

  return (
    <div
      className={`flex items-center gap-[9px] border-b border-line px-5 py-3 transition-colors hover:bg-surface-canvas ${
        selected ? 'bg-amore-bg/20 shadow-[inset_3px_0_0_var(--color-amore)]' : ''
      }`}
    >
      <SelectBox
        checked={selected}
        onToggle={onToggleSelect}
        ariaLabel={row.title}
        boxClassName="h-[15px] w-[15px] rounded-xs border-[1.6px]"
      />

      <div
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-icon border-2 border-ink text-xl ${
          FEATURE_TONE_BG[row.feature]
        } ${selected ? 'shadow-memphis-sm-faint' : ''}`}
      >
        {FEATURE_ICON[row.feature]}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`truncate text-lg font-bold ${
              row.status === 'error' ? 'text-mute-soft' : 'text-ink'
            }`}
          >
            {row.title}
          </span>
          <span className="shrink-0 rounded-xs border-[1.3px] border-line-strong px-1.5 font-mono-label text-xs font-bold text-mute-soft">
            {row.kind}
          </span>
        </div>
        {metaItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-[7px]">
            {metaItems.map((m, i) => (
              <span key={i} className="text-sm text-mute-soft">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="w-[120px] shrink-0">
        <StatusBadge status={row.status} label={t(`status.${row.status}`)} />
      </div>

      <div className="w-[104px] shrink-0 font-mono-label text-sm text-mute-soft">
        {formatUpdated(row.updated_at)}
      </div>

      <div className="w-[214px] shrink-0">
        <RowActions row={row} hasOrg={hasOrg} projects={projects} onChanged={onChanged} />
      </div>
    </div>
  );
}
