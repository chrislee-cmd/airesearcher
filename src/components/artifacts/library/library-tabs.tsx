'use client';

import { DuotoneIcon, type DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import { Pressable } from './pressable';

// /library in-frame 탭바 = **공유 chrome**(§0.1 · GEOMETRY §A1). 공유 전용 탭바가
// 아니라 표면 공용 — v1 은 「산출물 · 공유」 2탭(내보낸 문서·프로젝트는 표면이
// 생기면 config 에 추가).
//
// Soft Identity 리브랜드 1단계 — CD 03/04 탭 규칙 "활성 = 600 + 2px ink 밑줄"
// (핵심규칙 1 의 명시 예외 2곳 중 하나). 폴더 오버랩(1.5px ink 테두리 + 캔버스색
// 으로 하단선 덮기)은 Memphis 장치라 밑줄로 대체한다 — 탭 높이·패딩은 불변.

export type LibraryTab = { key: string; label: string; icon?: DuotoneIconName };

export function LibraryTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: LibraryTab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex items-end gap-0.5 px-6 pt-3">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            ariaLabel={tab.label}
            className={
              isActive
                ? 'flex items-center gap-[7px] border-b-2 border-ink px-4 py-[9px] text-lg font-semibold text-ink'
                : 'flex items-center gap-[7px] border-b-2 border-transparent px-4 py-[9px] text-lg font-medium text-soft-mute transition-colors hover:text-ink'
            }
          >
            {tab.icon && (
              <DuotoneIcon
                name={tab.icon}
                size={15}
                stroke={isActive ? undefined : 'var(--mute)'}
              />
            )}
            {tab.label}
          </Pressable>
        );
      })}
    </div>
  );
}
