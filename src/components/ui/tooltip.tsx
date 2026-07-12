'use client';

/* ────────────────────────────────────────────────────────────────────
   Tooltip — minimal hover/focus tooltip primitive.

   No radix dependency: a focusable anchor toggles a positioned bubble on
   pointer enter/leave and keyboard focus/blur, so the detail is reachable
   by mouse and keyboard alike. Content is short plain text (a sentence or
   two), rendered above the anchor.

   Used by the interview V2 trust panel to explain each hallucination-guard
   layer behind an ⓘ marker without expanding the row inline.
   ──────────────────────────────────────────────────────────────────── */

import { useId, useState, type ReactNode } from 'react';

export type TooltipProps = {
  // The explanatory text shown in the bubble.
  content: string;
  // The anchor (e.g. an ⓘ marker) the tooltip is attached to.
  children: ReactNode;
};

export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      data-ds-primitive="Tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span tabIndex={0} aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute bottom-full left-1/2 z-fab mb-2 w-64 -translate-x-1/2 rounded-sm border border-line bg-paper px-3 py-2 text-xs leading-relaxed text-ink-2 shadow-memphis-md"
        >
          {content}
        </span>
      )}
    </span>
  );
}
