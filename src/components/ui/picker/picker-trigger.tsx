'use client';

/* ────────────────────────────────────────────────────────────────────
   PickerTrigger · PickerGroup — 패널을 여는 버튼과 세그먼트 그룹 (BUILD-SPEC §1).

   Grouping 룰(드리프트 버그의 fix): 형제 픽커 2+ 는 한 세그먼트 컨트롤로 묶는다.
   단독 픽커는 standalone 트리거. free-floating pill 금지.

   **Soft Identity 리브랜드 1단계** — 셸 ④. 핵심규칙 6 "세그먼트/필터 토글은
   `--fill` 트랙 + 흰 선택 칩(그림자 `--sh-chip`). **검정 채움 세그먼트는 쓰지
   않는다**" + 변환표 "입력/피커 트리거: border 1 `--line` · radius 10 · focus =
   border ink + `--focus-ring`". 그래서:
     · 그룹 트랙 = `--fill` pill, 보더·ink 디바이더 없음(셀 간 선은 트랙이 흡수).
     · 그룹 셀 open = **흰 칩** + `--sh-chip`(옛 ink 채움 아님).
     · 단독 트리거 = 흰 면 + 1px `--line` + radius 10, 그림자 없음 · open =
       border ink + `--focus-ring`.
     · applied 배지 = ink pill(원색 amore 채움 → 중립 ink, 작은 면).
   상태 6종(default/hover/open/applied/focus/disabled)과 치수(패딩·높이)는 불변.
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

/* 단독 트리거 focus = border ink + --focus-ring. 그룹 셀은 트랙 안에 꼭 맞게
   들어가 링이 이웃 셀과 겹치므로 clip 되지 않는 inset outline(ink 1px)로 대체
   (둘 다 G6 "가시 focus" 충족). */
const STANDALONE_FOCUS =
  'outline-none focus-visible:border-ink focus-visible:shadow-soft-focus-ring';
const CELL_FOCUS =
  'outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-ink';

export type PickerTriggerProps = {
  /** 열림 상태 — open 이면 흰 칩(그룹) / border ink(단독) + caret ▲. */
  open?: boolean;
  /** 적용된 값 수 — >0 이면 ink 카운트 배지(§1 applied 상태). */
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
          <span className="inline-flex items-center justify-center rounded-pill bg-ink px-1.5 font-soft-mono text-xs-soft font-bold text-soft-surface">
            {appliedCount}
          </span>
        )}
        <span className="text-xs text-soft-faint" aria-hidden>
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
      // 세그먼트 셀 — 트랙(--fill)은 PickerGroup 소유. 선택(open) 셀만 흰 칩
      // (+ --sh-chip)으로 떠오르고, 비선택은 트랙색 위 투명이다(핵심규칙 6).
      return (
        <button
          {...commonAria}
          className={`inline-flex items-center gap-[7px] rounded-pill ${sm ? 'px-2.5 py-[5px] text-sm' : 'px-3 py-[7px] text-md'} font-bold transition-colors ${CELL_FOCUS} ${
            open
              ? 'bg-soft-surface text-ink shadow-soft-chip'
              : 'text-soft-mute hover:text-ink'
          } disabled:cursor-not-allowed disabled:bg-transparent disabled:text-soft-disabled ${className}`}
        >
          {label}
        </button>
      );
    }

    // Standalone — 전체 chrome. default 흰 면 + 1px --line · hover border 진하게
    // · open border ink + --focus-ring(검정 채움 금지 — 핵심규칙 6).
    return (
      <button
        {...commonAria}
        className={`inline-flex items-center gap-[7px] border ${sm ? 'rounded-nav px-2.5 py-[5px] text-sm' : 'rounded-control px-3 py-[7px] text-md'} bg-soft-surface font-bold text-ink transition-colors ${STANDALONE_FOCUS} ${
          open
            ? 'border-ink shadow-soft-focus-ring'
            : 'border-soft-line hover:border-soft-line-hover hover:bg-soft-surface-2'
        } disabled:cursor-not-allowed disabled:border-transparent disabled:bg-soft-fill disabled:text-soft-disabled ${className}`}
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
 * 형제 트리거 2+ 를 한 세그먼트 컨트롤로 묶는다(§1 Grouping). Soft 에서는
 * `--fill` 트랙 하나 안에 셀들이 들어가고 **디바이더가 없다**(선택 칩이 구분을
 * 담당 — 핵심규칙 6). ref 는 앵커(usePopoverBase.triggerRef)로 사용.
 */
export const PickerGroup = forwardRef<HTMLDivElement, PickerGroupProps>(
  function PickerGroup({ children, size = 'md', className = '' }, ref) {
    const items = Array.isArray(children) ? children : [children];
    const cells = items.filter(Boolean);
    return (
      <PickerGroupContext.Provider value={{ grouped: true, size }}>
        <div
          ref={ref}
          className={`inline-flex items-stretch gap-0.5 rounded-pill bg-soft-fill p-0.5 ${className}`}
        >
          {cells.map((cell, i) => (
            // 디바이더 없음 — 트랙 + 흰 선택 칩이 구분을 담당. 정적 자식 목록
            // 이라 index key 안정.
            <Fragment key={i}>{cell}</Fragment>
          ))}
        </div>
      </PickerGroupContext.Provider>
    );
  },
);
