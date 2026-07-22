'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

// Shared <Modal> primitive — replaces the 8 ad-hoc `fixed inset-0`
// backdrops scattered across the app (paywall, signup, share dialog,
// etc.) observed in 2026-05-31 audit.
//
// Behavior:
// - Esc closes
// - Click on backdrop closes (unless `dismissOnBackdrop={false}`)
// - Body scroll locked while open
// - Initial focus on the first focusable in the panel; restored on close
// - aria-modal + role="dialog" + aria-labelledby (if title given)
//
// Status: NOT YET CONSUMED. Migrations land in follow-up PRs.

type Size = 'sm' | 'md' | 'lg' | 'xl' | 'wide' | 'full';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: Size;
  // Panel placement. 'center' (default) is the classic centered dialog;
  // 'right' turns it into a full-height drawer that slides in from the right
  // edge (used by the admin user-observation timeline). All other behavior
  // (Esc, backdrop, scroll-lock, focus) is shared.
  side?: 'center' | 'right';
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
  // 슈퍼어드민 DS 인스펙터용 primitive 이름(카탈로그 label). 기본 'Modal'.
  // Modal 을 자기 chrome 으로 감싸는 상위 primitive(WidgetFullviewModal 등)가
  // 자기 이름으로 덮어써 인스펙터에 정확한 primitive 를 노출한다. Button 의
  // dsPrimitive override 패턴과 동일.
  dsPrimitive?: string;
  // Bare 모드 — 패널의 자체 border/bg/shadow/rounded/overflow + 헤더/본문/
  // 푸터 chrome 을 전부 걷어내고 positioning·sizing·transition·a11y·메커니즘
  // (Esc·backdrop·scroll-lock·focus)만 남긴다. children 이 프레임 비주얼을
  // 통째로 소유(예: FullviewShell §F1 프레임 — fv-frame-shadow/surface-canvas).
  // 미지정(기본 false)이면 기존 동작 그대로 → 모든 소비자 회귀 0.
  bare?: boolean;
};

const SIZE: Record<Size, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[1100px]',
  // 90% viewport with explicit margins so the panel reads as a modal,
  // not a page replacement. Capped at 1600×900 so it doesn't grow
  // unboundedly on ultra-wide displays. Used by full-view widget
  // surfaces (probing 등) that own their own internal grid.
  wide: 'w-[90vw] h-[90vh] max-w-[1600px] max-h-[900px]',
  // Edge-to-edge fullscreen — overrides the outer padding so the panel
  // covers the entire viewport. Used by full-view widget surfaces
  // (interviews 등) that own their own layout (2-col / 3-col grid).
  full: 'w-screen h-screen max-h-screen max-w-none !rounded-none',
};

// Right-drawer width (side="right"). Full-height panel pinned to the right
// edge; on narrow viewports it takes the full width.
const DRAWER_WIDTH = 'w-full max-w-[520px]';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  side = 'center',
  dismissOnBackdrop = true,
  labelledBy,
  dsPrimitive = 'Modal',
  bare = false,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  // Open/close transition: keep the portal mounted through the exit so the
  // panel can scale+fade out instead of snapping away. `render` gates the
  // DOM; `entered` drives the enter/leave visual state (opacity/scale).
  // The Esc / scroll-lock / focus effects below stay keyed on `open`, so
  // behavior (focus restore, scroll unlock) fires immediately on close and
  // only the visual teardown is deferred by one animation.
  const [render, setRender] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      // Mount, then flip to entered on the next frame so the enter transition
      // runs from the closed (scale-95/opacity-0) state. Synchronous mount is
      // the canonical enter-animation coordination for a portal'd overlay.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- enter-anim: mount before the rAF flip below
      setRender(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const id = setTimeout(() => setRender(false), reduced ? 0 : 180);
    return () => clearTimeout(id);
  }, [open, reduced]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock + initial focus + focus restore.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into panel.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const handleBackdrop = useCallback(() => {
    if (dismissOnBackdrop) onClose();
  }, [dismissOnBackdrop, onClose]);

  if (!render || typeof window === 'undefined') return null;

  const headingId = labelledBy ?? (title ? 'modal-title' : undefined);

  return createPortal(
    <div
      className={[
        'fixed inset-0 z-modal flex',
        side === 'right'
          ? 'items-stretch justify-end'
          : 'items-center justify-center',
        // Full-size + right drawer hug the edge, so zero padding there.
        size === 'full' || side === 'right' ? 'p-0' : 'p-4',
      ].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      // React synthetic events bubble through the React tree, not the DOM tree.
      // Without this stop, wheel inside the modal bubbles up to ancestors that
      // mount the modal (e.g. canvas-board onWheel zoom) even though the DOM
      // is portal'd to body. Stop here so the modal's wheel/touch never leaks.
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className={[
          'absolute inset-0 bg-ink/40',
          reduced ? '' : 'transition-opacity duration-[180ms] ease-out',
          entered ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={handleBackdrop}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        data-ds-primitive={dsPrimitive}
        className={[
          // flex-col + max-h: 본문이 viewport 보다 길어지면 패널이 잘리지
          // 않고 본문만 스크롤. (이전엔 overflow-hidden 만 있고 max-h 가
          // 없어서 화면 위아래로 spill 한 버그)
          'relative flex w-full flex-col',
          // bare: 패널 자체 border/bg/shadow/rounded/overflow + max-h 를 모두
          // 걷어낸다 — children(셸 프레임)이 유일한 비주얼 박스가 되고 프레임
          // 그림자가 패널에 clip 되지 않는다.
          bare ? '' : 'overflow-hidden border-[3px] border-ink bg-paper',
          // 일반 사이즈만 viewport 안에 맞도록 max-h; full / wide / 우측 드로어는
          // 자체적으로 h-screen / h-[90vh] / h-full 을 직접 잡는다.
          bare || size === 'full' || size === 'wide' || side === 'right'
            ? ''
            : 'max-h-[calc(100vh-2rem)]',
          // Memphis 외곽: 3px 검정 border + 8px offset 검정 그림자. full size 와
          // 우측 드로어는 edge 에 붙어 모서리·그림자 잘림 회피 위해 각지게.
          bare
            ? ''
            : side === 'right'
              ? 'h-full rounded-none'
              : size === 'full'
                ? 'rounded-none'
                : 'rounded-sm shadow-memphis-2xl',
          // Enter/leave: 우측 드로어는 오른쪽에서 슬라이드, 그 외는 중앙 scale+fade.
          // reduced-motion drops the transition so it snaps to the final state.
          reduced ? '' : 'transition-[transform,opacity] duration-[180ms] ease-out',
          side === 'right'
            ? entered
              ? 'translate-x-0 opacity-100'
              : 'translate-x-full opacity-0'
            : entered
              ? 'scale-100 opacity-100'
              : 'scale-95 opacity-0',
          side === 'right' ? DRAWER_WIDTH : SIZE[size],
        ].join(' ')}
      >
        {bare ? (
          // bare: chrome 없이 children 이 패널을 통째로 소유. h-full 로 채워
          // 프레임이 90vh 슬롯을 정확히 채운다.
          <div className="flex h-full w-full min-h-0 flex-col">{children}</div>
        ) : (
          <>
        {(title || description) && (
          <header className="shrink-0 border-b-[2px] border-ink px-5 pb-3 pt-4">
            {title ? (
              <h2
                id={headingId}
                className="text-2xl font-semibold tracking-[-0.01em] text-ink-2"
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-md leading-[1.6] text-mute">
                {description}
              </p>
            ) : null}
          </header>
        )}
        <div
          className={[
            'flex-1 text-lg leading-[1.65] text-ink-2',
            // full / wide size: 자체 layout (헤더/2-column/3-column grid) 을
            // children 이 owning. body padding + overflow-auto 끈다
            // (이중 스크롤 회피).
            size === 'full' || size === 'wide'
              ? 'flex min-h-0 flex-col overflow-hidden'
              : 'overflow-auto px-5 py-4',
          ].join(' ')}
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t-[2px] border-ink px-5 py-3">
            {footer}
          </footer>
        ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
