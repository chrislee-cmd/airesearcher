'use client';

/* ────────────────────────────────────────────────────────────────────
   Picker system — 패널 공용 파츠 (BUILD-SPEC §2 shared shell · §4 edge states).

   패널 셸(portal + 포지셔닝 + chrome), 섹션 라벨, 옵션 행(라디오/체크/필드),
   카운트, edge 상태(loading/empty/error), 인라인 검색, 우측 유틸 버튼, 액티브
   칩 행. 모든 값은 Phase 0 픽커 토큰(raw hex/px 없음 — 1.8px 체크박스 보더만
   토큰 없는 CD 절대값이라 raw 유지, BUILD-SPEC §5).

   ui/ 스코프라 native <button>/<input> 사용 허용(react/forbid-elements 면제) —
   소비처(리크루팅 등)는 이 파츠만 쓰므로 eslint-disable 불필요.
   ──────────────────────────────────────────────────────────────────── */

import {
  createPortal,
} from 'react-dom';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { computePanelStyle } from './picker-positioning';

/* 섹션 미니 라벨 — mono 9.5/700/.1em uppercase mute-soft(§2). */
export const PICKER_SECTION_LABEL_CLASS =
  'font-mono text-xs font-bold uppercase tracking-[0.1em] text-mute-soft';

/* ── 패널 셸 (portal + 포지셔닝 + chrome). ───────────────────────────── */
export function PickerPanel({
  panelRef,
  anchorRect,
  width,
  preferredHeight,
  className = '',
  style,
  children,
  role = 'dialog',
  ariaLabel,
  direction = 'col',
  onKeyDown,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  anchorRect: DOMRect;
  width: number;
  preferredHeight?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  role?: 'dialog' | 'listbox';
  ariaLabel?: string;
  /** 'col' = P1/P2 세로 · 'row' = P3 2-pane 가로. */
  direction?: 'col' | 'row';
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const posStyle = computePanelStyle(anchorRect, width, preferredHeight);
  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      style={{ ...posStyle, ...style }}
      onKeyDown={onKeyDown}
      // menu-in = 등장 애니메이션(기존) · z-overlay = 기존 픽커 z(598 결정, CD 60 기각).
      className={`menu-in z-overlay flex ${direction === 'row' ? 'flex-row' : 'flex-col'} overflow-hidden rounded-picker-panel border-2 border-ink bg-paper shadow-picker-panel ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ── 라디오 행 (P1 단일선택). 15px 라디오 dot. ───────────────────────── */
export const PickerRadioRow = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    selected: boolean;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function PickerRadioRow({ label, selected, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex items-center gap-[9px] rounded-picker-option px-2.5 py-2 text-left outline-none transition-colors focus-visible:bg-line-soft/50 ${
        selected ? 'bg-picker-option-selected' : 'hover:bg-line-soft/30'
      } ${className}`}
      {...rest}
    >
      <span
        className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-ink' : 'border-ink/[0.26]'
        }`}
      >
        {selected && <span className="h-[7px] w-[7px] rounded-full bg-ink" />}
      </span>
      <span
        className={`flex-1 truncate text-lg text-ink ${selected ? 'font-extrabold' : 'font-semibold'}`}
      >
        {label}
      </span>
    </button>
  );
});

/* ── 체크 행 (P2/P3 멀티선택). 17px 체크박스 + optional 카운트. ───────── */
export const PickerCheckRow = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    selected: boolean;
    count?: number;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function PickerCheckRow({ label, selected, count, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex items-center gap-2.5 rounded-picker-option px-2.5 py-2 text-left outline-none transition-colors focus-visible:bg-line-soft/50 ${
        selected ? 'bg-picker-option-selected' : 'hover:bg-line-soft/30'
      } ${className}`}
      {...rest}
    >
      <span
        // 1.8px 보더 = CD 절대값(토큰 없음, BUILD-SPEC §5). ui/ 라 border-[Npx] 미차단.
        className={`inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-picker-check border-[1.8px] border-ink text-sm font-extrabold text-white ${
          selected ? 'bg-ink' : 'bg-paper'
        }`}
        aria-hidden
      >
        {selected ? '✓' : ''}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-lg text-ink ${selected ? 'font-bold' : 'font-medium'}`}
      >
        {label}
      </span>
      {count != null && (
        <span className="shrink-0 font-mono text-sm text-mute-soft">{count}</span>
      )}
    </button>
  );
});

/* ── 필드 행 (P3 좌측 pane). active border + optional 배지 + chevron. ─── */
export const PickerFieldRow = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    active: boolean;
    appliedCount?: number;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function PickerFieldRow({ label, active, appliedCount = 0, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      className={`flex items-center gap-2 rounded-picker-option px-2.5 py-2 text-left outline-none transition-colors focus-visible:border-amore ${
        active
          ? 'border-[1.5px] border-ink bg-paper'
          : 'border-[1.5px] border-transparent hover:bg-line-soft/30'
      } ${className}`}
      {...rest}
    >
      <span
        className={`min-w-0 flex-1 truncate text-md ${active ? 'font-extrabold text-ink' : 'font-semibold text-ink-2'}`}
      >
        {label}
      </span>
      {appliedCount > 0 && (
        <span className="shrink-0 rounded-full bg-amore px-1.5 font-mono text-xs font-bold text-white">
          {appliedCount}
        </span>
      )}
      <span
        className={`shrink-0 text-sm ${active ? 'text-ink' : 'text-line-empty'}`}
        aria-hidden
      >
        ›
      </span>
    </button>
  );
});

/* ── Edge: Loading (skeleton 4행 72/58/80/46%). ──────────────────────── */
export function PickerLoading() {
  const widths = ['72%', '58%', '80%', '46%'];
  return (
    <div className="flex animate-pulse flex-col gap-[9px] p-3" aria-hidden>
      {widths.map((w) => (
        <div key={w} className="flex items-center gap-[10px]">
          <div className="h-[17px] w-[17px] shrink-0 rounded-picker-check bg-surface-disabled" />
          <div className="h-[11px] rounded-xs bg-surface-disabled" style={{ width: w }} />
        </div>
      ))}
    </div>
  );
}

/* ── Edge: Empty (dashed 타일 + 🔍 + 안내). ──────────────────────────── */
export function PickerEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-[7px] px-4 py-7 text-center">
      {/* design-allow-hardcoded -- CD empty 타일 radius 11 (§4): Phase 0 픽커 토큰(5/8/10/13, §5)에 없는 off-scale CD 절대값. proposed-token: radius-picker-empty-tile (Phase 2/3). */}
      <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border-2 border-dashed border-line-empty text-2xl">
        🔍
      </div>
      <div className="text-md font-bold text-ink">{title}</div>
      {hint && <div className="text-sm leading-[1.45] text-mute-soft">{hint}</div>}
    </div>
  );
}

/* ── Edge: Error (warning note + ↻ Retry). ───────────────────────────── */
export function PickerError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 p-4">
      <div className="flex items-start gap-2 rounded-picker-trigger border-[1.5px] border-warning-line-amber bg-warning-bg px-3 py-2.5">
        <span aria-hidden>⚠️</span>
        <div className="text-sm leading-[1.5] text-warning-text">{message}</div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start rounded-full border-[1.5px] border-ink px-3 py-[5px] text-sm font-bold text-ink shadow-memphis-sm outline-none transition-colors hover:bg-paper-soft focus-visible:shadow-focus-ring"
      >
        ↻ {retryLabel}
      </button>
    </div>
  );
}

/* ── 인라인 검색 필드. 툴바(기본) / 패널 dense 두 규격. ──────────────── */
export function PickerSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  dense = false,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel?: string;
  /** true = 패널 내부(9px radius, 전폭) · false = 툴바(10px radius, 190px). */
  dense?: boolean;
  className?: string;
}) {
  // dense(패널) 검색 radius 9 = CD 절대값(BUILD-SPEC §2 P2/P3 search): Phase 0 픽커
  // 토큰(5/8/10/13)에 없는 off-scale, 597 선례 동일. 툴바(비-dense)=rounded-picker-trigger.
  // design-allow-hardcoded -- proposed-token: picker-search-radius (Phase 2/3 승격 후보).
  const shapeCls = dense ? 'rounded-[9px] px-2.5 py-1.5' : 'rounded-picker-trigger px-3 py-[7px]';
  return (
    <div
      className={`inline-flex items-center gap-[7px] border-[1.5px] border-ink/[0.16] bg-paper ${shapeCls} focus-within:border-ink/40 ${className}`}
    >
      <span aria-hidden className={dense ? 'text-sm text-faint' : 'text-mute-soft'}>
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={`${dense ? 'w-full' : 'w-[190px]'} bg-transparent text-md text-ink outline-none ${dense ? 'placeholder:text-faint' : 'placeholder:text-mute-soft'}`}
      />
    </div>
  );
}

/* ── 우측 유틸 버튼(export 등, §1 "secondary utilities"). caret 없는 트리거 chrome. */
export function PickerUtilityButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-picker-trigger border-[1.5px] border-ink bg-paper px-3 py-[7px] text-xs font-bold text-ink shadow-memphis-sm outline-none transition-colors hover:bg-paper-soft focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── 액티브 필터 칩 행 (§2 — 2+ 필터러블 필드에서만). ────────────────── */
export type PickerChip = {
  id: string;
  fieldLabel: string;
  valueLabel: string;
  onRemove: () => void;
  removeLabel: string;
};

export function PickerChipRow({
  activeLabel,
  chips,
  clearAllLabel,
  onClearAll,
  className = '',
}: {
  activeLabel: string;
  chips: PickerChip[];
  clearAllLabel: string;
  onClearAll: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/10 bg-picker-option-selected px-[18px] py-2.5 ${className}`}
    >
      <span className={`${PICKER_SECTION_LABEL_CLASS}`}>{activeLabel}</span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-[7px] rounded-full border-[1.5px] border-ink bg-paper py-1 pl-[11px] pr-1.5 shadow-memphis-sm-faint"
        >
          <span className="text-sm text-mute-soft">{chip.fieldLabel}</span>
          <span className="text-xs font-bold text-ink">{chip.valueLabel}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={chip.removeLabel}
            className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-full bg-line-soft/60 text-xs text-mute outline-none hover:bg-line-soft focus-visible:shadow-focus-ring"
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-sm text-mute-soft underline outline-none focus-visible:text-ink"
      >
        {clearAllLabel}
      </button>
    </div>
  );
}
