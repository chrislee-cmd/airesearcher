'use client';

import { DuotoneIcon, type DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import { Pressable } from './pressable';

// /library in-frame 탭바 = **공유 chrome**(§0.1 · GEOMETRY §A1). 공유 전용 탭바가
// 아니라 표면 공용 — v1 은 「산출물 · 공유」 2탭(내보낸 문서·프로젝트는 표면이
// 생기면 config 에 추가). 활성 탭은 프레임 본문과 이어붙는다(rounded-t-control +
// bg surface-canvas + 하단 border 를 캔버스색으로 덮고 margin-bottom -1.5px).

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
                ? 'flex items-center gap-[7px] rounded-t-control border-[1.5px] border-ink border-b-surface-canvas bg-surface-canvas px-4 py-[9px] text-lg font-extrabold text-ink -mb-[1.5px]'
                : 'flex items-center gap-[7px] border-[1.5px] border-transparent px-4 py-[9px] text-lg font-bold text-mute'
            }
          >
            {tab.icon && (
              <DuotoneIcon
                name={tab.icon}
                size={15}
                stroke={isActive ? undefined : 'var(--color-mute)'}
              />
            )}
            {tab.label}
          </Pressable>
        );
      })}
    </div>
  );
}
