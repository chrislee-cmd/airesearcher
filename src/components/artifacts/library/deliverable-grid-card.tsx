'use client';

import { useTranslations } from 'next-intl';
import type { DeliverableRow } from '@/lib/artifacts/types';
import { FEATURE_ICON, FEATURE_TONE_BG } from './constants';
import { formatProgress, formatUpdatedShort } from './format';
import { SelectBox } from './pressable';
import { StatusBadge } from './status-badge';
import { RowActions } from './row-actions';

// Grid card — same DeliverableRow, card treatment. Tone header strip carries
// identity (A3); selected card gains the amore memphis shadow.

export function DeliverableGridCard({
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
      className={`flex flex-col overflow-hidden rounded-sm border-2 border-ink bg-paper ${
        selected ? 'shadow-memphis-md-amore' : 'shadow-memphis-md-faint'
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b-2 border-ink px-[13px] py-[9px] ${
          FEATURE_TONE_BG[row.feature]
        }`}
      >
        <span className="text-lg">{FEATURE_ICON[row.feature]}</span>
        <span className="min-w-0 flex-1 truncate font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-ink">
          {t(`feature.${row.feature}`)}
        </span>
        <SelectBox
          checked={selected}
          onToggle={onToggleSelect}
          ariaLabel={row.title}
          boxClassName="h-[15px] w-[15px] rounded-xs border-[1.6px]"
        />
      </div>

      <div className="flex flex-1 flex-col gap-[9px] p-[13px]">
        <div
          className={`text-lg font-bold leading-snug ${
            row.status === 'error' ? 'text-mute-soft' : 'text-ink'
          }`}
        >
          {row.title}
        </div>
        {metaItems.length > 0 && (
          <div className="flex flex-col gap-[3px]">
            {metaItems.map((m, i) => (
              <span key={i} className="text-sm text-mute-soft">
                {m}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2">
          <StatusBadge status={row.status} label={t(`status.${row.status}`)} size="sm" />
          <span className="ml-auto font-mono-label text-xs text-mute-soft">
            {formatUpdatedShort(row.updated_at)}
          </span>
        </div>
      </div>

      <div className="border-t-[1.5px] border-line-strong px-[13px] py-[9px]">
        <RowActions row={row} hasOrg={hasOrg} projects={projects} onChanged={onChanged} />
      </div>
    </div>
  );
}
