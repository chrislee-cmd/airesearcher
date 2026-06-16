'use client';

import type { ReportVersionRow } from '@/lib/reports/versions';
import { Button } from '@/components/ui/button';

const ENHANCEMENT_LABEL: Record<string, string> = {
  trends: '트렌드',
  logs: '로그',
  perspective: '관점',
};

export function VersionSelector({
  versions,
  selectedVersion,
  onSelect,
  onSetHead,
  disabled,
}: {
  versions: ReportVersionRow[];
  selectedVersion: number;
  onSelect: (v: number) => void;
  onSetHead?: (v: number) => void;
  disabled?: boolean;
}) {
  if (versions.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.18em] text-mute-soft">
        Version
      </span>
      {versions.map((v) => {
        const active = v.version === selectedVersion;
        const label =
          v.version === 0
            ? 'v0 원본'
            : `v${v.version} +${ENHANCEMENT_LABEL[v.enhancement ?? ''] ?? '강화'}`;
        return (
          <Button
            key={v.id}
            variant={active ? 'primary' : 'ghost'}
            size="xs"
            disabled={disabled}
            onClick={() => onSelect(v.version)}
            onDoubleClick={() => onSetHead?.(v.version)}
            title={
              v.parent_version != null
                ? `v${v.parent_version}에서 분기 · 더블클릭=head로 설정`
                : '원본'
            }
            className={`!px-2.5 !py-1 !text-[11.5px] !rounded-xs ${
              active ? '' : 'hover:!border-ink-2'
            }`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
