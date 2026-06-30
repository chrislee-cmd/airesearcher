'use client';

import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';
import { IconButton } from '@/components/ui/icon-button';

// Shared <WidgetFullviewModal> — generalizes the full-view "chrome" that
// canvas widgets (probing 등) reach for when they pop their dense surface
// into a near-fullscreen modal: a title/subtitle band with a close ×,
// a scrollable body slot, and an optional footer band.
//
// Why a wrapper instead of using <Modal> directly:
//   <Modal>'s built-in title/description/footer renders a header WITHOUT a
//   close button. Full-view widget surfaces want an explicit × in the
//   header (the body owns its own grid and the backdrop is easy to miss on
//   a 90vw panel). So this wrapper renders its OWN header/body/footer as the
//   Modal's children — Modal's wide/full size strips body padding + overflow
//   so the chrome fills the panel edge-to-edge.
//
// Behavior inherited from <Modal>: Esc closes · backdrop click closes ·
// body scroll lock · focus restore · z-modal(50) · Memphis outer border.
//
// size:
//   'wide' (default) — 90vw × 90vh, capped 1600×900. Reads as a modal.
//   'full'           — edge-to-edge fullscreen. For surfaces that own a
//                      multi-column layout end-to-end.
//
// Status: NOT YET CONSUMED. Widgets wire this in a follow-up PR.

type WidgetFullviewModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Reuses Modal's existing wide/full sizes — no new viewport token. */
  size?: 'wide' | 'full';
  footer?: ReactNode;
  children: ReactNode;
  /** aria-label for the close button. i18n override; defaults to 닫기. */
  closeLabel?: string;
};

export function WidgetFullviewModal({
  open,
  onClose,
  title,
  subtitle,
  size = 'wide',
  footer,
  children,
  closeLabel = '닫기',
}: WidgetFullviewModalProps) {
  return (
    <Modal open={open} onClose={onClose} size={size}>
      <header className="flex shrink-0 items-center justify-between border-b-[2px] border-ink px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold tracking-[-0.01em] text-ink-2">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-md text-mute">{subtitle}</p>
          ) : null}
        </div>
        <IconButton
          variant="bordered"
          size="md"
          onClick={onClose}
          aria-label={closeLabel}
          className="ml-4 shrink-0"
        >
          <CloseIcon />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {footer ? (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t-[2px] border-ink px-6 py-3">
          {footer}
        </footer>
      ) : null}
    </Modal>
  );
}

// Inline × glyph. Explicit h-4 w-4 + aria-hidden satisfies the a11y QA
// rules (icon-only control labelled by its IconButton; SVG sized).
function CloseIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
