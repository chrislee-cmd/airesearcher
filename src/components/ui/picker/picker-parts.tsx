'use client';

/* ────────────────────────────────────────────────────────────────────
   Picker system — 패널 공용 파츠 (BUILD-SPEC §2 shared shell · §4 edge states).

   패널 셸(portal + 포지셔닝 + chrome), 섹션 라벨, 옵션 행(라디오/체크/필드),
   카운트, edge 상태(loading/empty/error), 인라인 검색, 우측 유틸 버튼, 액티브
   칩 행.

   **Soft Identity 리브랜드 1단계** — 셸 ④. 변환표 "팝오버/피커 패널: border 1
   `--line` · radius 12 · `--sh-popover` · 행 radius 8 · 선택 행 `--fill`"
   (기존 border 2 ink · 하드 오프셋 · 선택 행 sun 틴트). 지오메트리(폭·패딩·
   체크박스 17/15px·포지셔닝)는 불변 — 색/선/그림자/radius 만 교체.

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
import { CloseButton } from '@/components/ui/close-button';
import { computePanelStyle } from './picker-positioning';

/* 섹션 미니 라벨 — mono 9.5/700/.1em uppercase mute-soft(§2). */
export const PICKER_SECTION_LABEL_CLASS =
  'font-soft-mono text-xs font-bold uppercase tracking-[0.1em] text-soft-faint';

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
      className={`menu-in z-overlay flex ${direction === 'row' ? 'flex-row' : 'flex-col'} overflow-hidden rounded-panel border border-soft-line bg-soft-surface shadow-soft-popover ${className}`}
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
      className={`flex items-center gap-[9px] rounded-nav px-2.5 py-2 text-left outline-none transition-colors focus-visible:shadow-soft-focus-ring ${
        selected ? 'bg-soft-fill' : 'hover:bg-soft-surface-2'
      } ${className}`}
      {...rest}
    >
      <span
        className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-ink' : 'border-soft-line-hover'
        }`}
      >
        {selected && <span className="h-[7px] w-[7px] rounded-full bg-ink" />}
      </span>
      <span
        className={`flex-1 truncate text-lg text-ink ${selected ? 'font-bold' : 'font-medium'}`}
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
      className={`flex items-center gap-2.5 rounded-nav px-2.5 py-2 text-left outline-none transition-colors focus-visible:shadow-soft-focus-ring ${
        selected ? 'bg-soft-fill' : 'hover:bg-soft-surface-2'
      } ${className}`}
      {...rest}
    >
      <span
        // Soft: 1px 보더(핵심규칙 1 — 1.8px 포함 굵은 선 전부 1px 로).
        className={`inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-picker-check border text-sm font-bold text-soft-surface ${
          selected ? 'border-ink bg-ink' : 'border-soft-line bg-soft-surface'
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
        <span className="shrink-0 font-soft-mono text-sm text-soft-faint">{count}</span>
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
      className={`flex items-center gap-2 rounded-nav border px-2.5 py-2 text-left outline-none transition-colors focus-visible:shadow-soft-focus-ring ${
        active
          ? 'border-soft-line bg-soft-surface'
          : 'border-transparent hover:bg-soft-surface-2'
      } ${className}`}
      {...rest}
    >
      <span
        className={`min-w-0 flex-1 truncate text-md ${active ? 'font-bold text-ink' : 'font-medium text-soft-ink-2'}`}
      >
        {label}
      </span>
      {appliedCount > 0 && (
        <span className="shrink-0 rounded-pill bg-ink px-1.5 font-soft-mono text-xs font-bold text-soft-surface">
          {appliedCount}
        </span>
      )}
      <span
        className={`shrink-0 text-sm ${active ? 'text-ink' : 'text-soft-disabled'}`}
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
          <div className="h-[17px] w-[17px] shrink-0 rounded-picker-check bg-soft-fill" />
          <div className="h-[11px] rounded-xs bg-soft-fill" style={{ width: w }} />
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
      {/* Soft 변환표 "빈 상태 타일: 1.5 dashed #d6d4da(=--line-hover)". radius 는
          Soft r-inner(10)로 — 기존 off-scale 11px 하드코드가 사라진다. */}
      <div className="flex h-[38px] w-[38px] items-center justify-center rounded-control border-[1.5px] border-dashed border-soft-line-hover text-2xl">
        🔍
      </div>
      <div className="text-md font-bold text-ink">{title}</div>
      {hint && <div className="text-sm leading-[1.45] text-soft-mute">{hint}</div>}
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
      <div className="flex items-start gap-2 rounded-control bg-soft-warn-bg px-3 py-2.5">
        <span aria-hidden>⚠️</span>
        <div className="text-sm leading-[1.5] text-soft-warn-fg">{message}</div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="self-start rounded-pill border border-soft-line bg-soft-surface px-3 py-[5px] text-sm font-bold text-ink outline-none transition-colors hover:border-soft-line-hover hover:bg-soft-surface-2 focus-visible:shadow-soft-focus-ring"
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
  // Soft: 변환표 "입력/피커 트리거 radius 10(검색은 pill)". 패널 내부(dense)는
  // 행 radius 리듬에 맞춰 r-control(8), 툴바 검색은 pill — CD 04 "검색 pill 260".
  const shapeCls = dense ? 'rounded-nav px-2.5 py-1.5' : 'rounded-pill px-3 py-[7px]';
  return (
    <div
      className={`inline-flex items-center gap-[7px] border border-soft-line bg-soft-surface ${shapeCls} focus-within:border-ink focus-within:shadow-soft-focus-ring ${className}`}
    >
      <span aria-hidden className={dense ? 'text-sm text-soft-faint' : 'text-soft-faint'}>
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={`${dense ? 'w-full' : 'w-[190px]'} bg-transparent text-md text-ink outline-none placeholder:text-soft-faint`}
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
      className={`inline-flex items-center gap-1.5 rounded-pill border border-soft-line bg-soft-surface px-3 py-[7px] text-xs font-bold text-ink outline-none transition-colors hover:border-soft-line-hover hover:bg-soft-surface-2 focus-visible:shadow-soft-focus-ring disabled:cursor-not-allowed disabled:border-transparent disabled:bg-soft-fill disabled:text-soft-disabled ${className}`}
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
      className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-soft-hair bg-soft-surface-2 px-[18px] py-2.5 ${className}`}
    >
      <span className={`${PICKER_SECTION_LABEL_CLASS}`}>{activeLabel}</span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-[7px] rounded-pill bg-soft-fill py-1 pl-[11px] pr-1.5"
        >
          <span className="text-sm text-soft-mute">{chip.fieldLabel}</span>
          <span className="text-xs font-bold text-ink">{chip.valueLabel}</span>
          {/* 칩 내부 제거 ✕ — BUILD-SPEC §1-C chip-clear. 칩 pill 이 이미
              보더 상자라 ✕ 는 글리프만 들고 간다(기존 17px 회색 원 배경 제거).
              옆의 "전체 해제"는 텍스트 버튼이라 이 변종 대상이 아니다. */}
          <CloseButton
            variant="chip-clear"
            onClick={chip.onRemove}
            aria-label={chip.removeLabel}
          />
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-sm text-soft-mute underline outline-none focus-visible:text-ink"
      >
        {clearAllLabel}
      </button>
    </div>
  );
}
