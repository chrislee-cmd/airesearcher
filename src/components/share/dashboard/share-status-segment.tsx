'use client';

import { Fragment } from 'react';
import { Pressable } from '@/components/artifacts/library/pressable';
import type { ShareStatus, ShareStatusCounts } from './types';

// 상태 세그먼트(툴바) — 살아있는 링크(active) / 만료 / 철회 / 전체. 개수를 붙여
// 필터가 곧 요약이 되게 한다(§0.4). 기본 선택 = active("살아있는 링크").
// 로딩 중에는 카운트도 skeleton(§1.9 — 0 으로 그리면 빈 상태로 오독).

// 필터 키: null 이 아니라 명시적 4-값(active/expired/revoked/all).
export type StatusFilter = ShareStatus | 'all';

const ORDER: { key: StatusFilter; countKey: keyof ShareStatusCounts }[] = [
  { key: 'active', countKey: 'alive' },
  { key: 'expired', countKey: 'expired' },
  { key: 'revoked', countKey: 'revoked' },
  { key: 'all', countKey: 'all' },
];

export function ShareStatusSegment({
  value,
  counts,
  loading,
  onChange,
  labels,
}: {
  value: StatusFilter;
  counts: ShareStatusCounts;
  loading: boolean;
  onChange: (v: StatusFilter) => void;
  labels: Record<StatusFilter, string>;
}) {
  return (
    <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-pill border-[1.5px] border-ink bg-paper shadow-memphis-sm-faint">
      {ORDER.map((seg, i) => {
        const active = value === seg.key;
        return (
          <Fragment key={seg.key}>
            {i > 0 && <span className="w-[1.5px] bg-ink" />}
            <Pressable
              onPress={() => onChange(seg.key)}
              ariaLabel={labels[seg.key]}
              className={`flex items-center gap-1.5 px-[15px] py-[7px] text-md ${
                active ? 'bg-ink font-extrabold text-paper' : 'font-bold text-mute'
              }`}
            >
              {labels[seg.key]}
              {loading ? (
                <span className="inline-block h-3 w-3.5 rounded-2xs bg-surface-disabled" />
              ) : (
                <span
                  className={`font-mono-label ${active ? 'opacity-70' : 'text-faint'}`}
                >
                  {counts[seg.countKey]}
                </span>
              )}
            </Pressable>
          </Fragment>
        );
      })}
    </span>
  );
}
