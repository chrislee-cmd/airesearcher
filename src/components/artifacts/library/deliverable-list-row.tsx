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
// action 214 fixed columns — 전부 불변.
//
// Soft Identity 리브랜드 1단계 — 변환표 "리스트 행: border-b 1 #f4f3f6(=--fill)
// · hover --surface-2" + "34 아이콘 타일"(원색은 작은 면 = 타일에 남기고 테두리
// 는 제거) + 선택 행은 --fill 면.

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
      className={`flex items-center gap-[9px] border-b border-soft-fill px-5 py-3 transition-colors hover:bg-soft-surface-2 ${
        selected ? 'bg-soft-fill ' : ''
      }`}
    >
      <SelectBox
        checked={selected}
        onToggle={onToggleSelect}
        ariaLabel={row.title}
        boxClassName="h-[15px] w-[15px] rounded-xs border"
      />

      <div
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-control text-xl ${
          FEATURE_TONE_BG[row.feature]
        }`}
      >
        {FEATURE_ICON[row.feature]}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`truncate text-lg font-bold ${
              row.status === 'error' ? 'text-soft-mute' : 'text-ink'
            }`}
          >
            {row.title}
          </span>
          <span className="shrink-0 rounded-chip bg-soft-fill px-1.5 font-soft-mono text-xs font-bold text-soft-mute">
            {row.kind}
          </span>
        </div>
        {metaItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-[7px]">
            {metaItems.map((m, i) => (
              <span key={i} className="text-sm text-soft-faint">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="w-[120px] shrink-0">
        <StatusBadge status={row.status} label={t(`status.${row.status}`)} />
      </div>

      <div className="w-[104px] shrink-0 font-soft-mono text-sm text-soft-faint">
        {formatUpdated(row.updated_at)}
      </div>

      <div className="w-[214px] shrink-0">
        <RowActions row={row} hasOrg={hasOrg} projects={projects} onChanged={onChanged} />
      </div>
    </div>
  );
}
