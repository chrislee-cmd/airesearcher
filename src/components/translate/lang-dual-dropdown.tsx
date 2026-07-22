'use client';

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ControlTrigger } from '../ui/control-trigger';

// ─── LangDualDropdown — 동시통역 언어 통합 드롭다운 (2컬럼) ───────────────────
// 원어(source) / 대상어(target) 를 두 개의 분리된 DropdownMenu 로 두던 걸
// 단일 "언어" 드롭다운 하나로 통합 (사용자 2026-07-10). 트리거는 ControlTrigger
// (다른 컨트롤 드롭다운과 동일 chrome). 클릭 시 커스텀 popover 가 열리고
// 좌 = 인풋 언어 목록 / 우 = 아웃풋 언어 목록을 side-by-side 로 동시 노출한다
// (별도 토글 없이). 좌 클릭 = source, 우 클릭 = target.
//
// DropdownMenu primitive 는 단일-컬럼 items 리스트만 렌더하므로 2컬럼 content 를
// 담을 수 없다 → spec 결정 B 의 "소형 커스텀 popover" 경로. 앵커/포털/바깥클릭/
// Esc 로직과 chrome 토큰은 DropdownMenu 를 그대로 미러 (portal→body + position
// fixed 로 canvas widget 카드의 overflow:hidden / transform 을 탈출).
//
// translate 국소 컴포넌트 — 재사용 수요가 생기면 primitive 로 승격 (spec 관계절).

export type LangOption = { value: string; label: string };

type Props = {
  langs: LangOption[];
  sourceLang: string;
  targetLang: string;
  onSelectSource: (value: string) => void;
  onSelectTarget: (value: string) => void;
  /** 아무것도 안 골랐을 때 트리거 placeholder (t('select')). */
  placeholder: string;
  /** 좌측 컬럼 헤딩 — 인풋 언어 (t('inputLang')). */
  inputLabel: string;
  /** 우측 컬럼 헤딩 — 아웃풋 언어 (t('outputLang')). */
  outputLabel: string;
  /** 트리거 aria-label (t('lang')). */
  triggerLabel: string;
  disabled?: boolean;
  className?: string;
  /** 트리거를 컬럼 풀폭으로 렌더(세팅 아코디언 STEP3). 기본은 content-width
   *  (inline-block + min-w-44) — 라이브 컨트롤보드의 가로 배치 유지용. */
  fullWidth?: boolean;
};

export function LangDualDropdown({
  langs,
  sourceLang,
  targetLang,
  onSelectSource,
  onSelectTarget,
  placeholder,
  inputLabel,
  outputLabel,
  triggerLabel,
  disabled,
  className,
  fullWidth = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();

  const close = useCallback(() => setOpen(false), []);

  // 세션 시작(live)/busy 로 disabled 되면 열려있던 패널은 즉시 숨긴다.
  // effect 로 open state 를 되돌리지 않고 파생값으로 gate → cascading render 회피.
  const panelOpen = open && !disabled;

  const updateRect = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    setAnchorRect(el.getBoundingClientRect());
  }, []);

  // Recompute anchor on open + on scroll/resize while open (position:fixed).
  useLayoutEffect(() => {
    if (!panelOpen) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [panelOpen, updateRect]);

  // Click outside — check BOTH wrapper (trigger) and menu (portal'd to body).
  useEffect(() => {
    if (!panelOpen) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [panelOpen, close]);

  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const labelOf = (value: string) =>
    langs.find((l) => l.value === value)?.label ?? value;

  // 둘 다 선택 시 "원어 → 대상어" 요약, 아니면 placeholder ("선택").
  const triggerText =
    sourceLang && targetLang
      ? `${labelOf(sourceLang)} → ${labelOf(targetLang)}`
      : placeholder;

  const menuStyle: CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        minWidth: Math.max(320, anchorRect.width),
      }
    : { position: 'fixed', visibility: 'hidden' };

  const portalTarget =
    typeof document !== 'undefined' ? document.body : null;

  function renderColumn(
    heading: string,
    selected: string,
    onSelect: (value: string) => void,
    borderLeft: boolean,
  ) {
    return (
      <div
        role="group"
        aria-label={heading}
        className={borderLeft ? 'border-l border-line-soft' : undefined}
      >
        <div className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
          {heading}
        </div>
        {langs.map((l) => {
          const isSelected = l.value === selected;
          return (
            // native <button> — DropdownMenu primitive 의 메뉴 아이템과 동일
            // 패턴. 이 컴포넌트는 translate 국소라 ui/ 예외 밖 → per-line
            // 마킹 (§3.8 sanctioned).
            // eslint-disable-next-line react/forbid-elements -- 커스텀 popover 메뉴 아이템, DropdownMenu primitive 미러
            <button
              key={l.value}
              type="button"
              data-canvas-action
              aria-pressed={isSelected}
              onClick={() => onSelect(l.value)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-[120ms] focus:bg-line-soft/40 focus:outline-none ${
                isSelected
                  ? 'font-semibold text-ink'
                  : 'text-ink-2 hover:bg-line-soft/40'
              }`}
            >
              <span className="truncate">{l.label}</span>
              {isSelected ? (
                <span aria-hidden className="shrink-0 text-amore">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={fullWidth ? 'relative block w-full' : 'relative inline-block'}
      ref={wrapRef}
    >
      <ControlTrigger
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={panelOpen}
        aria-label={triggerLabel}
        data-open={panelOpen}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={className ?? (fullWidth ? undefined : 'min-w-44')}
      >
        {triggerText}
      </ControlTrigger>
      {panelOpen && portalTarget
        ? createPortal(
            <div
              ref={menuRef}
              aria-labelledby={triggerId}
              onKeyDown={onPanelKeyDown}
              className="menu-in z-overlay grid grid-cols-2 rounded-sm border-[2px] border-ink bg-paper py-1 shadow-[3px_3px_0_black]"
              style={menuStyle}
            >
              {renderColumn(inputLabel, sourceLang, onSelectSource, false)}
              {renderColumn(outputLabel, targetLang, onSelectTarget, true)}
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}
