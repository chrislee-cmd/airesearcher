'use client';

// Voice Concierge — coachmark overlay (PR4 Bundle 4).
//
// PR3 wired the highlightUI tool to dispatch a `voice:highlight`
// CustomEvent on window. PR4 finally listens for it and renders the
// spotlight + tooltip. Auto-clears after 5s OR on any user click/scroll.
//
// Design notes:
//   - Spotlight technique: a transparent rect with a huge outset
//     box-shadow dims the rest of the viewport without an SVG mask.
//   - Targets are looked up by `getElementById(targetId)` first, then
//     `[data-coachmark-id="<id>"]` as a fallback (some components use
//     unstable ids but tag their root with the data attribute).
//   - Outer overlay is pointer-events-none so the user can keep clicking
//     the page even while a coachmark is up. Both auto-fade triggers
//     (click anywhere, scroll) work because the listeners are bound to
//     window in the capture phase.

import { useEffect, useLayoutEffect, useState } from 'react';

type HighlightEventDetail = {
  targetId: string;
  message?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PADDING = 6;
const TOOLTIP_GAP = 12;
const TOOLTIP_MAX_W = 280;
const AUTO_DISMISS_MS = 5000;

function findTarget(targetId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const byId = document.getElementById(targetId);
  if (byId) return byId;
  // Fallback to data attribute. Use the most-specific match (no
  // querySelectorAll loop needed — the first match is fine).
  return document.querySelector<HTMLElement>(
    `[data-coachmark-id="${cssEscape(targetId)}"]`,
  );
}

// CSS.escape isn't available everywhere — basic safety pass for the
// kinds of ids we expect ("sidebar-interviews" etc.).
function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}

export function HighlightOverlay() {
  const [rect, setRect] = useState<Rect | null>(null);
  const [message, setMessage] = useState<string>('');

  // Wire the listener once on mount. We keep `active` derived from
  // `rect != null` — clearing rect = clearing the overlay.
  useEffect(() => {
    function onHighlight(e: Event) {
      const ce = e as CustomEvent<HighlightEventDetail>;
      const detail = ce.detail;
      if (!detail || !detail.targetId) return;
      const el = findTarget(detail.targetId);
      if (!el) {
        // Silent no-op per spec — the toast emitted from the tool itself
        // already gives the user feedback.
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top - PADDING,
        left: r.left - PADDING,
        width: r.width + PADDING * 2,
        height: r.height + PADDING * 2,
      });
      setMessage(detail.message ?? '');
    }

    window.addEventListener('voice:highlight', onHighlight as EventListener);
    return () => {
      window.removeEventListener(
        'voice:highlight',
        onHighlight as EventListener,
      );
    };
  }, []);

  // Auto-dismiss + user-dismiss listeners. Scoped to the active overlay.
  useEffect(() => {
    if (!rect) return;
    const t = window.setTimeout(() => setRect(null), AUTO_DISMISS_MS);
    const clear = () => setRect(null);
    // Capture phase so any click/scroll anywhere dismisses, even on
    // elements that stopPropagation.
    window.addEventListener('click', clear, true);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('keydown', clear, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', clear, true);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('keydown', clear, true);
    };
  }, [rect]);

  // Re-measure on resize so the spotlight tracks the target if the
  // viewport changes during the 5s window.
  useLayoutEffect(() => {
    if (!rect) return;
    function reposition() {
      // Re-measure all known targets? We only have the one — re-find
      // by reading the current rect, but we don't have the targetId in
      // scope. Cheap path: just clear on resize. Same UX outcome.
      setRect(null);
    }
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [rect]);

  if (!rect) return null;

  // Tooltip placement — below the target by default, flip above if
  // the viewport bottom is too close. Center horizontally on the target,
  // clamped to the viewport with a 12px gutter.
  const TOOLTIP_H_BUDGET = 64; // rough — single short sentence
  const fitsBelow =
    rect.top + rect.height + TOOLTIP_GAP + TOOLTIP_H_BUDGET + 12 <
    window.innerHeight;
  const tooltipTop = fitsBelow
    ? rect.top + rect.height + TOOLTIP_GAP
    : rect.top - TOOLTIP_GAP - TOOLTIP_H_BUDGET;
  const targetCenter = rect.left + rect.width / 2;
  const tooltipLeftRaw = targetCenter - TOOLTIP_MAX_W / 2;
  const tooltipLeft = Math.max(
    12,
    Math.min(window.innerWidth - TOOLTIP_MAX_W - 12, tooltipLeftRaw),
  );

  return (
    <div
      className="pointer-events-none fixed inset-0 z-overlay"
      aria-hidden="true"
    >
      {/* Spotlight cutout */}
      <div
        className="absolute [border-radius:10px] transition-[top,left,width,height] duration-150 ease-out"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 9999px rgba(15, 17, 21, 0.45)',
        }}
      />

      {/* Tooltip — pointer-events-none means it's purely informational;
          any click on the page dismisses both overlay and tooltip. */}
      {message && (
        <div
          className={
            'absolute border border-line bg-paper px-3 py-2 text-md ' +
            'text-ink-2 [border-radius:10px] shadow-[0_4px_12px_rgba(15,17,21,0.18)]'
          }
          style={{
            top: tooltipTop,
            left: tooltipLeft,
            maxWidth: TOOLTIP_MAX_W,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
