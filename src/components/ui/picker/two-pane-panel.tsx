'use client';

/* ────────────────────────────────────────────────────────────────────
   TwoPanePanel (P3) — 부모 필드 → 값 2-pane 멀티선택 + 명시 Apply (BUILD-SPEC §2).

   좌 pane = 필드(질문/컬럼/카테고리/언어그룹), 우 pane = 그 필드의 값(체크박스).
   내부 draft(Record<fieldId, string[]>)로 pending 을 모아 Apply 시 일괄 반영.
   폭 500–660. 검색은 우 pane 옵션 >threshold 일 때.

   협소 폭(<520, G7): 1열 drill-down — 필드 목록 → 선택 시 값 목록(‹ back 행).

   a11y(G6): 각 pane role=listbox(값 pane aria-multiselectable). ↑↓ 이동 ·
   ← → pane 이동 · Space 토글 · Enter 적용 · Esc 닫기+포커스 복원.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { PickerField, PickerOption } from './types';
import { useRovingIndex } from './use-roving-index';
import {
  PickerPanel,
  PickerCheckRow,
  PickerFieldRow,
  PickerEmpty,
  PickerSearchField,
  PICKER_SECTION_LABEL_CLASS,
} from './picker-parts';

const NARROW_MAX = 520; // G7 임계

export type TwoPaneFilterState = Record<string, string[]>;

export type TwoPanePanelLabels = {
  fieldSection: string;
  valuesSection: string;
  selectAll: string;
  reset: string;
  apply: string;
  /** "N selected" 접미(예: "개 선택"). */
  selectedSuffix: string;
  searchPlaceholder: string;
  /** 좌 pane 필드 없음. */
  noFields: string;
  /** 우 pane 검색 무결과(기본 CD dashed-tile empty). */
  noAnswersTitle: string;
  noAnswersHint?: string;
  /** 우 pane 검색 무결과 커스텀 렌더(주면 CD dashed-tile 대신 사용 — 소비처가
   *  기존 표면과 픽셀 정합을 유지해야 할 때). */
  renderNoAnswers?: () => ReactNode;
  /** drill-down back 행 prefix(예: "‹"). */
  backLabel: string;
};

export type TwoPanePanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  anchorRect: DOMRect;
  width?: number;
  /** 패널 선호 높이(2-pane, px). */
  height?: number;
  ariaLabel?: string;
  fields: PickerField[];
  optionsFor: (fieldId: string) => PickerOption[];
  /** 이미 적용된 필터(패널 open 시 draft 초기값). */
  applied: TwoPaneFilterState;
  onApply: (next: TwoPaneFilterState) => void;
  searchThreshold?: number;
  labels: TwoPanePanelLabels;
  /** 푸터 좌측 요약. 기본 "N selected". 소비처가 행수 미리보기 등 커스텀. */
  renderSummary?: (ctx: {
    draft: TwoPaneFilterState;
    activeFieldId: string;
    activeSelectedCount: number;
  }) => ReactNode;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function TwoPanePanel({
  panelRef,
  anchorRect,
  width = 660,
  height = 330,
  ariaLabel,
  fields,
  optionsFor,
  applied,
  onApply,
  searchThreshold = 8,
  labels,
  renderSummary,
  onClose,
  returnFocusRef,
}: TwoPanePanelProps) {
  const narrow = width < NARROW_MAX;

  const [draft, setDraft] = useState<TwoPaneFilterState>(() => ({ ...applied }));
  const [activeFieldId, setActiveFieldId] = useState<string>(() => {
    const firstApplied = fields.find((f) => (applied[f.id]?.length ?? 0) > 0);
    return firstApplied?.id ?? fields[0]?.id ?? '';
  });
  const [answerSearch, setAnswerSearch] = useState('');
  // 'fields' | 'values' — 키보드 활성 pane(넓은 폭) · drill-down view(협소).
  const [pane, setPane] = useState<'fields' | 'values'>('fields');

  const activeField = fields.find((f) => f.id === activeFieldId);
  const options = useMemo(
    () => (activeFieldId ? optionsFor(activeFieldId) : []),
    [activeFieldId, optionsFor],
  );
  const visibleOptions = useMemo(() => {
    const q = answerSearch.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, answerSearch]);

  const activeSelected = draft[activeFieldId] ?? [];
  const showSearch = options.length > searchThreshold;

  const selectActiveField = useCallback((id: string) => {
    setActiveFieldId(id);
    setAnswerSearch('');
  }, []);

  const fieldsRoving = useRovingIndex({
    count: fields.length,
    active: pane === 'fields',
    autoFocus: true,
    initialIndex: Math.max(
      0,
      fields.findIndex((f) => f.id === activeFieldId),
    ),
  });
  const valuesRoving = useRovingIndex({
    count: visibleOptions.length,
    active: pane === 'values',
    autoFocus: true,
  });

  const toggleValue = (value: string) => {
    setDraft((d) => {
      const cur = d[activeFieldId] ?? [];
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      const copy = { ...d };
      if (next.length > 0) copy[activeFieldId] = next;
      else delete copy[activeFieldId];
      return copy;
    });
  };

  const selectAll = () => {
    setDraft((d) => {
      const all = options.map((o) => o.value);
      const cur = d[activeFieldId] ?? [];
      const allOn = all.length > 0 && all.every((v) => cur.includes(v));
      const copy = { ...d };
      if (allOn) delete copy[activeFieldId];
      else copy[activeFieldId] = all;
      return copy;
    });
  };

  const escapeClose = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      returnFocusRef?.current?.focus();
      return true;
    }
    return false;
  };

  const onFieldsKeyDown = (e: React.KeyboardEvent) => {
    if (escapeClose(e)) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (visibleOptions.length > 0 || narrow) {
        setPane('values');
        if (!narrow) requestAnimationFrame(() => valuesRoving.focusActive());
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const f = fields[fieldsRoving.activeIndex];
      if (f) {
        selectActiveField(f.id);
        if (narrow) setPane('values');
      }
      return;
    }
    fieldsRoving.onKeyDown(e);
  };

  const onValuesKeyDown = (e: React.KeyboardEvent) => {
    if (escapeClose(e)) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPane('fields');
      requestAnimationFrame(() => fieldsRoving.focusActive());
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      onApply(draft);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      const o = visibleOptions[valuesRoving.activeIndex];
      if (o) toggleValue(o.value);
      return;
    }
    valuesRoving.onKeyDown(e);
  };

  const summary = renderSummary
    ? renderSummary({ draft, activeFieldId, activeSelectedCount: activeSelected.length })
    : (
        <>
          <b className="text-ink">{activeSelected.length}</b> {labels.selectedSuffix}
        </>
      );

  // ── 좌 pane(필드 목록) ──
  const fieldsPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`border-b-[1.5px] border-ink/[0.12] px-3 py-[9px] ${PICKER_SECTION_LABEL_CLASS}`}
      >
        {labels.fieldSection}
      </div>
      {fields.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-md text-mute-soft">
          {labels.noFields}
        </div>
      ) : (
        <div
          role="listbox"
          aria-label={labels.fieldSection}
          onKeyDown={onFieldsKeyDown}
          className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto p-1.5"
        >
          {fields.map((f, i) => (
            <PickerFieldRow
              key={f.id}
              label={f.label}
              active={f.id === activeFieldId}
              appliedCount={draft[f.id]?.length ?? 0}
              onClick={() => {
                selectActiveField(f.id);
                if (narrow) setPane('values');
              }}
              {...fieldsRoving.getItemProps(i)}
            />
          ))}
        </div>
      )}
    </div>
  );

  // ── 우 pane(값 목록 + 검색 + 푸터) ──
  const valuesPane = (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b-[1.5px] border-ink/[0.12] px-[13px] py-[9px]">
        {narrow && (
          <button
            type="button"
            onClick={() => setPane('fields')}
            className="shrink-0 text-sm font-bold text-ink outline-none focus-visible:text-amore-deep"
          >
            {labels.backLabel} {activeField?.label ?? ''}
          </button>
        )}
        {!narrow && (
          <span className={`min-w-0 truncate ${PICKER_SECTION_LABEL_CLASS}`}>
            {labels.valuesSection} · {activeField?.label ?? ''}
          </span>
        )}
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
            value={answerSearch}
            onChange={setAnswerSearch}
            placeholder={labels.searchPlaceholder}
          />
        </div>
      )}

      <div
        role="listbox"
        aria-multiselectable
        aria-label={labels.valuesSection}
        onKeyDown={onValuesKeyDown}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1.5"
      >
        {visibleOptions.map((o, i) => (
          <PickerCheckRow
            key={o.value}
            label={o.label}
            selected={activeSelected.includes(o.value)}
            count={o.count}
            onClick={() => toggleValue(o.value)}
            {...valuesRoving.getItemProps(i)}
          />
        ))}
        {options.length > 0 &&
          visibleOptions.length === 0 &&
          (labels.renderNoAnswers ? (
            labels.renderNoAnswers()
          ) : (
            <PickerEmpty title={labels.noAnswersTitle} hint={labels.noAnswersHint} />
          ))}
      </div>

      <div className="flex items-center gap-[9px] border-t-2 border-ink bg-paper-soft px-[13px] py-2.5">
        <span className="text-sm text-mute">{summary}</span>
        <div className="ml-auto flex gap-[7px]">
          <button
            type="button"
            onClick={() => setDraft({})}
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
    </div>
  );

  // ── 협소: 1열 drill-down(필드 or 값) · 넓은 폭: 2-pane. ──
  if (narrow) {
    return (
      <PickerPanel
        panelRef={panelRef}
        anchorRect={anchorRect}
        width={width}
        preferredHeight={height}
        role="dialog"
        ariaLabel={ariaLabel ?? labels.fieldSection}
        direction="col"
      >
        {pane === 'fields' ? fieldsPane : valuesPane}
      </PickerPanel>
    );
  }

  return (
    <PickerPanel
      panelRef={panelRef}
      anchorRect={anchorRect}
      width={width}
      preferredHeight={height}
      role="dialog"
      ariaLabel={ariaLabel ?? labels.fieldSection}
      direction="row"
    >
      <div className="flex w-[250px] shrink-0 flex-col border-r-2 border-ink bg-surface-canvas">
        {fieldsPane}
      </div>
      {valuesPane}
    </PickerPanel>
  );
}
