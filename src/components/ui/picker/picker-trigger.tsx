'use client';

/* ────────────────────────────────────────────────────────────────────
   PickerTrigger · PickerGroup — 패널을 여는 버튼과 세그먼트 그룹 (BUILD-SPEC §1).

   Grouping 룰(드리프트 버그의 fix): 형제 픽커 2+ 는 한 세그먼트 컨트롤로 묶는다
   — 단일 1.5px ink 보더 · radius 10 · shadow · overflow hidden · 셀을 1.5px ink
   디바이더로 분할. 단독 픽커는 standalone 트리거. free-floating pill 금지.

   상태 6종(§1, 모든 표면 동일): default paper · hover paper-soft(단독) /
   line-soft(그룹 셀, 597 동일) · open ink fill+white+▲ · applied amore 배지 ·
   focus 가시 링(G6) · disabled surface-disabled+faint+no shadow+비포커스.

   토큰: radius-picker-trigger(10)/-option(8) · shadow-memphis-sm(md)/-xs(sm) ·
   control-h-md/-sm · focus-ring. raw hex/px 없음(AUTHORITY: CD 값 = Phase 0 토큰).
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  forwardRef,
  Fragment,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import type { PickerSize } from './types';

type GroupCtx = { grouped: boolean; size: PickerSize };
const PickerGroupContext = createContext<GroupCtx | null>(null);

/* 단독 트리거 focus 링 = DS focus-ring 토큰(§5). 그룹 셀은 부모 overflow-hidden
   이 box-shadow 링을 잘라먹으므로 clip 되지 않는 inset outline 로 대체(둘 다 G6
   "가시 focus" 충족). */
const STANDALONE_FOCUS =
  'outline-none focus-visible:shadow-focus-ring';
const CELL_FOCUS =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amore';

export type PickerTriggerProps = {
  /** 열림 상태 — open 이면 ink fill + caret ▲. */
  open?: boolean;
  /** 적용된 값 수 — >0 이면 amore 카운트 배지(§1 applied 상태). */
  appliedCount?: number;
  /** 좌측 아이콘 렌더 — on(open) 을 받아 stroke 색 반전. */
  icon?: (on: boolean) => ReactNode;
  /** 라벨. */
  children: ReactNode;
  size?: PickerSize;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/**
 * 패널 트리거. PickerGroup 안이면 세그먼트 셀(bare)로, 밖이면 standalone chrome
 * 으로 렌더된다.
 */
export const PickerTrigger = forwardRef<HTMLButtonElement, PickerTriggerProps>(
  function PickerTrigger(
    { open = false, appliedCount = 0, icon, children, size: sizeProp, disabled, className = '', ...rest },
    ref,
  ) {
    const ctx = useContext(PickerGroupContext);
    const grouped = ctx?.grouped ?? false;
    const size = sizeProp ?? ctx?.size ?? 'md';
    const sm = size === 'sm';

    const label = (
      <>
        {icon?.(open)}
        <span className={grouped ? '' : 'truncate'}>{children}</span>
        {appliedCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-amore px-1.5 font-mono text-xs-soft font-bold text-white">
            {appliedCount}
          </span>
        )}
        <span className="text-xs text-mute-soft" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </>
    );

    const commonAria = {
      type: 'button' as const,
      'aria-haspopup': 'listbox' as const,
      'aria-expanded': open,
      disabled,
      ref,
      ...rest,
    };

    if (grouped) {
      // 세그먼트 셀 — 보더/radius/shadow 는 PickerGroup 이 소유. 셀은 padding +
      // 상태 배경만.
      return (
        <button
          {...commonAria}
          className={`inline-flex items-center gap-[7px] ${sm ? 'px-2.5 py-[5px] text-sm' : 'px-3 py-[7px] text-md'} font-bold transition-colors ${CELL_FOCUS} ${
            open
              ? 'bg-ink text-white'
              : 'text-ink hover:bg-line-soft/40'
          } disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-faint ${className}`}
        >
          {label}
        </button>
      );
    }

    // Standalone — 전체 chrome. default paper · hover paper-soft · open ink.
    return (
      <button
        {...commonAria}
        className={`inline-flex items-center gap-[7px] border-[1.5px] ${sm ? 'rounded-picker-option px-2.5 py-[5px] text-sm shadow-memphis-xs' : 'rounded-picker-trigger px-3 py-[7px] text-md shadow-memphis-sm'} font-bold transition-colors ${STANDALONE_FOCUS} ${
          open
            ? 'border-ink bg-ink text-white'
            : 'border-ink bg-paper text-ink hover:bg-paper-soft'
        } disabled:cursor-not-allowed disabled:border-ink/[0.18] disabled:bg-surface-disabled disabled:text-faint disabled:shadow-none ${className}`}
      >
        {label}
      </button>
    );
  },
);

export type PickerGroupProps = {
  children: ReactNode;
  size?: PickerSize;
  /** 추가 className(레이아웃용 — shrink-0 등). */
  className?: string;
};

/**
 * 형제 트리거 2+ 를 한 세그먼트 컨트롤로 묶는다(§1 Grouping). 자식 사이에
 * 1.5px ink 디바이더를 자동 삽입. ref 는 앵커(usePopoverBase.triggerRef)로 사용.
 */
export const PickerGroup = forwardRef<HTMLDivElement, PickerGroupProps>(
  function PickerGroup({ children, size = 'md', className = '' }, ref) {
    const items = Array.isArray(children) ? children : [children];
    const cells = items.filter(Boolean);
    return (
      <PickerGroupContext.Provider value={{ grouped: true, size }}>
        <div
          ref={ref}
          className={`inline-flex items-stretch overflow-hidden border-[1.5px] border-ink bg-paper ${size === 'sm' ? 'rounded-picker-option shadow-memphis-xs' : 'rounded-picker-trigger shadow-memphis-sm'} ${className}`}
        >
          {cells.map((cell, i) => (
            // 셀 사이 1.5px ink 디바이더. 정적 자식 목록이라 index key 안정.
            <Fragment key={i}>
              {i > 0 && <div className="w-[1.5px] shrink-0 bg-ink" aria-hidden />}
              {cell}
            </Fragment>
          ))}
        </div>
      </PickerGroupContext.Provider>
    );
  },
);
