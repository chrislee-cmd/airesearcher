'use client';

/* ────────────────────────────────────────────────────────────────────
   MultiSelectPanel (P2) — 체크박스 멀티선택 + 명시 Apply (BUILD-SPEC §2).

   내부 draft 로 pending 선택을 모으고 Apply 시 일괄 반영(G3: multi = explicit
   Apply — 체크마다 447행 refetch 방지). 검색은 옵션 >threshold(기본 8) 일 때.
   폭 280–330. 값별 카운트 optional(G5).

   a11y(G6): role=listbox aria-multiselectable, 옵션 role=option[aria-selected].
   ↑↓ 이동 · Space 토글 · Enter 적용 · Esc 닫기+포커스 복원.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo, useState, type RefObject } from 'react';
import type { PickerOption } from './types';
import { useRovingIndex } from './use-roving-index';
import {
  PickerPanel,
  PickerCheckRow,
  PickerEmpty,
  PickerSearchField,
  PICKER_SECTION_LABEL_CLASS,
} from './picker-parts';

export type MultiSelectPanelLabels = {
  selectAll: string;
  reset: string;
  apply: string;
  /** "N selected" 의 접미(예: "개 선택"). */
  selectedSuffix: string;
  searchPlaceholder: string;
  /** 검색 무결과. */
  noMatchTitle: string;
  noMatchHint?: string;
};

export type MultiSelectPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  anchorRect: DOMRect;
  width?: number;
  ariaLabel?: string;
  sectionLabel: string;
  options: PickerOption[];
  /** 이미 적용된 값(패널 open 시 draft 초기값). */
  selected: string[];
  onApply: (next: string[]) => void;
  /** 검색 노출 임계(기본 8, BUILD-SPEC §2). */
  searchThreshold?: number;
  labels: MultiSelectPanelLabels;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function MultiSelectPanel({
  panelRef,
  anchorRect,
  width = 320,
  ariaLabel,
  sectionLabel,
  options,
  selected,
  onApply,
  searchThreshold = 8,
  labels,
  onClose,
  returnFocusRef,
}: MultiSelectPanelProps) {
  const [draft, setDraft] = useState<string[]>(() => [...selected]);
  const [search, setSearch] = useState('');

  const showSearch = options.length > searchThreshold;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const roving = useRovingIndex({
    count: visible.length,
    active: true,
    autoFocus: true,
  });

  const toggle = (val: string) =>
    setDraft((d) => (d.includes(val) ? d.filter((v) => v !== val) : [...d, val]));

  const allOn = options.length > 0 && options.every((o) => draft.includes(o.value));
  const selectAll = () =>
    setDraft(allOn ? [] : options.map((o) => o.value));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      returnFocusRef?.current?.focus();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onApply(draft);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      const o = visible[roving.activeIndex];
      if (o) toggle(o.value);
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
      <div className="flex items-center gap-2 border-b-[1.5px] border-ink/[0.12] px-[13px] py-[9px]">
        <span className={`min-w-0 truncate ${PICKER_SECTION_LABEL_CLASS}`}>
          {sectionLabel}
        </span>
        {options.length > 0 && (
          <button
            type="button"
            onClick={selectAll}
            className="ml-auto shrink-0 text-sm font-bold text-amore-deep outline-none focus-visible:text-ink"
          >
            {labels.selectAll}
          </button>
        )}
      </div>

      {showSearch && (
        <div className="border-b border-ink/[0.08] px-[13px] py-2">
          <PickerSearchField
            dense
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder={labels.searchPlaceholder}
          />
        </div>
      )}

      <div
        role="listbox"
        aria-multiselectable
        aria-label={sectionLabel}
        onKeyDown={onKeyDown}
        className="flex max-h-[230px] min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-1.5"
      >
        {visible.map((o, i) => (
          <PickerCheckRow
            key={o.value}
            label={o.label}
            selected={draft.includes(o.value)}
            count={o.count}
            onClick={() => toggle(o.value)}
            {...roving.getItemProps(i)}
          />
        ))}
        {options.length > 0 && visible.length === 0 && (
          <PickerEmpty title={labels.noMatchTitle} hint={labels.noMatchHint} />
        )}
      </div>

      <div className="flex items-center gap-[9px] border-t-2 border-ink bg-paper-soft px-[13px] py-2.5">
        <span className="text-sm text-mute">
          <b className="text-ink">{draft.length}</b> {labels.selectedSuffix}
        </span>
        <div className="ml-auto flex gap-[7px]">
          <button
            type="button"
            onClick={() => setDraft([])}
            className="rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-1.5 text-xs font-bold text-ink outline-none transition-colors hover:bg-line-soft/30 focus-visible:shadow-focus-ring"
          >
            {labels.reset}
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-full border-2 border-ink bg-ink px-4 py-1.5 text-xs font-extrabold text-white shadow-memphis-sm outline-none focus-visible:shadow-focus-ring"
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </PickerPanel>
  );
}
