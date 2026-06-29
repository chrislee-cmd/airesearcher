'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

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
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
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

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissOnBackdrop = true,
  labelledBy,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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

  if (!open || typeof window === 'undefined') return null;

  const headingId = labelledBy ?? (title ? 'modal-title' : undefined);

  return createPortal(
    <div
      className={[
        'fixed inset-0 z-modal flex items-center justify-center',
        // Full-size needs zero padding so the panel covers edge-to-edge.
        size === 'full' ? 'p-0' : 'p-4',
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
        className="absolute inset-0 bg-ink/40"
        onClick={handleBackdrop}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={[
          // flex-col + max-h: 본문이 viewport 보다 길어지면 패널이 잘리지
          // 않고 본문만 스크롤. (이전엔 overflow-hidden 만 있고 max-h 가
          // 없어서 화면 위아래로 spill 한 버그)
          'relative flex w-full flex-col overflow-hidden border-[3px] border-ink bg-paper',
          // 일반 사이즈만 viewport 안에 맞도록 max-h; full / wide 은
          // 자체적으로 h-screen / h-[90vh] 를 SIZE 에서 직접 잡는다.
          size === 'full' || size === 'wide' ? '' : 'max-h-[calc(100vh-2rem)]',
          // Memphis 외곽: 3px 검정 border + 8px offset 검정 그림자. full
          // size 는 edge-to-edge 라 그림자/모서리 잘림 회피 위해 둘 다 끈다.
          size === 'full'
            ? 'rounded-none'
            : 'rounded-sm shadow-[8px_8px_0_var(--color-ink)]',
          SIZE[size],
        ].join(' ')}
      >
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
      </div>
    </div>,
    document.body,
  );
}
