'use client';

/* ────────────────────────────────────────────────────────────────────
   usePopoverBase — portal 팝오버/메뉴 프리미티브의 공통분모 훅.

   왜: CitationPopover / DateRangePopover / DropdownMenu 가 각자
   (1) trigger 위치 측정 + 열린 동안 scroll/resize 추적, (2) 바깥
   mousedown + Escape 로 닫기 — 두 effect 를 거의 동일하게 중복 구현했다
   (포지셔닝/a11y 수정이 3곳 분산). 이 두 mechanical 중복만 단일화한다.

   범위 (공통분모만 — 과추상화 금지):
     - 포함: anchor rect 측정/추적, 바깥클릭·Escape 닫기, portal 은 소비자가
       `createPortal(document.body)` 로 직접 (target 계산이 사소).
     - 제외(각자 유지): 실제 배치 계산(clamp/align/side 차이), 키보드 nav
       (DropdownMenu), Modal 의 스크롤락·포커스트랩·enter/leave 애니메이션.
       Modal 은 centered(inset-0) 라 trigger 앵커 모델 자체가 다르다 —
       이 훅 대상 아님.

   포지셔닝: `anchorRect`(측정된 trigger DOMRect) 를 돌려주기만 하고, 실제
   left/top/align 계산은 소비자가 render 중에 한다. rect 은 open 시 1회 +
   scroll(capture)/resize 마다 갱신되므로 position:fixed 패널이 trigger 를
   따라간다. 측정 전(닫힘/첫 프레임)에는 null.

   닫기: open 인 동안 document 에 mousedown/keydown 을 건다. mousedown 이
   trigger 래퍼·패널 어느 쪽도 아니면 onClose. Escape 는 closeOnEscape 로
   opt-out 가능 — DropdownMenu 는 자체 menu keydown(Escape + arrow nav) 을
   유지하려고 끈다(기존 동작 보존).
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export type UsePopoverBaseOptions = {
  /** 팝오버 열림 여부. 소비자가 소유. */
  open: boolean;
  /** 바깥클릭 / Escape 시 호출. 안정 참조 권장(useCallback). */
  onClose: () => void;
  /** document Escape 로 닫기. default true. (DropdownMenu 는 false — 자체 처리) */
  closeOnEscape?: boolean;
  /** 바깥 mousedown 으로 닫기. default true. */
  closeOnOutsideClick?: boolean;
};

export type UsePopoverBaseResult<
  T extends HTMLElement,
  P extends HTMLElement,
> = {
  /** trigger(또는 trigger 를 감싼 래퍼)에 붙일 ref — rect 측정 + 바깥클릭 판정 기준. */
  triggerRef: RefObject<T | null>;
  /** portal 패널에 붙일 ref — 바깥클릭 판정 시 패널 내부 클릭을 제외. */
  panelRef: RefObject<P | null>;
  /** 측정된 trigger DOMRect. 측정 전 null. scroll/resize 마다 갱신. */
  anchorRect: DOMRect | null;
};

export function usePopoverBase<
  T extends HTMLElement = HTMLElement,
  P extends HTMLElement = HTMLElement,
>({
  open,
  onClose,
  closeOnEscape = true,
  closeOnOutsideClick = true,
}: UsePopoverBaseOptions): UsePopoverBaseResult<T, P> {
  const triggerRef = useRef<T | null>(null);
  const panelRef = useRef<P | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // open 시 trigger rect 측정 + scroll(capture, 중첩 스크롤러 대응)/resize
  // 마다 재측정 → position:fixed 패널이 trigger 를 따라간다.
  useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const update = () => setAnchorRect(el.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // 바깥 mousedown(trigger·패널 모두 제외) + Escape 로 닫기.
  useEffect(() => {
    if (!open) return;
    if (!closeOnOutsideClick && !closeOnEscape) return;
    function onMouseDown(e: MouseEvent) {
      const node = e.target as Node;
      if (triggerRef.current?.contains(node)) return;
      if (panelRef.current?.contains(node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (closeOnOutsideClick) document.addEventListener('mousedown', onMouseDown);
    if (closeOnEscape) {
      document.addEventListener('keydown', onKey as EventListener);
    }
    return () => {
      if (closeOnOutsideClick) {
        document.removeEventListener('mousedown', onMouseDown);
      }
      if (closeOnEscape) {
        document.removeEventListener('keydown', onKey as EventListener);
      }
    };
  }, [open, onClose, closeOnEscape, closeOnOutsideClick]);

  return { triggerRef, panelRef, anchorRect };
}
