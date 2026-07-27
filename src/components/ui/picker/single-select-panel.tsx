'use client';

/* ────────────────────────────────────────────────────────────────────
   SingleSelectPanel (P1) — 라디오 단일선택, 즉시 적용 + 닫힘 (BUILD-SPEC §2).

   Apply 버튼 없음(G3: single = instant + close). 폭 240–320. optional 방향
   푸터(정렬 Asc/Desc 세그먼트 — P1 footer = direction segment, sort only).

   a11y(G6): 옵션 컨테이너 role=listbox, 옵션 role=option[aria-selected].
   ↑↓ 이동 · Enter/Space 선택 · Esc 닫기+트리거 포커스 복원.
   ──────────────────────────────────────────────────────────────────── */

import type { RefObject } from 'react';
import type { PickerOption } from './types';
import { useRovingIndex } from './use-roving-index';
import {
  PickerPanel,
  PickerRadioRow,
  PICKER_SECTION_LABEL_CLASS,
} from './picker-parts';

export type SingleSelectPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  anchorRect: DOMRect;
  width?: number;
  ariaLabel?: string;
  /** 섹션 미니 라벨(예: "정렬 기준"). */
  sectionLabel: string;
  options: PickerOption[];
  /** 선택된 값. */
  value: string;
  /** 선택 시(즉시). 소비처가 패널을 닫는다. */
  onSelect: (value: string) => void;

  // ── optional 방향 푸터(정렬 전용) ──
  direction?: 'asc' | 'desc';
  onDirectionChange?: (dir: 'asc' | 'desc') => void;
  /** 방향 세그먼트 좌측 라벨(예: "순서"). */
  orderLabel?: string;
  /** Asc/Desc 셀 라벨(화살표 포함해 소비처가 전달). */
  ascLabel?: string;
  descLabel?: string;
  /** 정렬 필드 미선택 시 방향 비활성. */
  directionDisabled?: boolean;

  /** Esc/바깥클릭 close 콜백. */
  onClose: () => void;
  /** 닫힐 때 포커스 되돌릴 트리거 요소. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function SingleSelectPanel({
  panelRef,
  anchorRect,
  width = 320,
  ariaLabel,
  sectionLabel,
  options,
  value,
  onSelect,
  direction,
  onDirectionChange,
  orderLabel,
  ascLabel,
  descLabel,
  directionDisabled = false,
  onClose,
  returnFocusRef,
}: SingleSelectPanelProps) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const roving = useRovingIndex({
    count: options.length,
    active: true,
    initialIndex: selectedIndex,
    autoFocus: true,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      returnFocusRef?.current?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[roving.activeIndex];
      if (o) onSelect(o.value);
      return;
    }
    roving.onKeyDown(e);
  };

  return (
    <PickerPanel
      panelRef={panelRef}
      anchorRect={anchorRect}
      width={width}
      role="dialog"
      ariaLabel={ariaLabel ?? sectionLabel}
    >
      <div
        className={`border-b-[1.5px] border-ink/[0.12] px-[13px] py-[9px] ${PICKER_SECTION_LABEL_CLASS}`}
      >
        {sectionLabel}
      </div>
      <div
        role="listbox"
        aria-label={sectionLabel}
        onKeyDown={onKeyDown}
        className="flex max-h-[230px] flex-col gap-0.5 overflow-y-auto p-1.5"
      >
        {options.map((o, i) => (
          <PickerRadioRow
            key={o.value || '__none'}
            label={o.label}
            selected={value === o.value}
            onClick={() => onSelect(o.value)}
            {...roving.getItemProps(i)}
          />
        ))}
      </div>

      {direction && (
        <div className="flex items-center gap-[9px] border-t-[1.5px] border-ink/[0.12] px-[13px] py-2.5">
          <span className={PICKER_SECTION_LABEL_CLASS}>{orderLabel}</span>
          <div
            className={`ml-auto inline-flex overflow-hidden rounded-full border-[1.5px] border-ink shadow-memphis-sm ${
              directionDisabled ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            {(['asc', 'desc'] as const).map((dir) => {
              const on = direction === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onDirectionChange?.(dir)}
                  className={`px-[13px] py-[5px] text-sm outline-none transition-colors focus-visible:bg-line-soft/40 ${
                    on
                      ? 'bg-ink font-extrabold text-white'
                      : 'bg-paper font-semibold text-mute'
                  }`}
                >
                  {dir === 'asc' ? ascLabel : descLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </PickerPanel>
  );
}
