'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewHeaderSlot — publish-up channel for per-widget header actions.

   The shared <FullviewHeader> (FULLVIEW-SHELL.md §F3) is rendered by
   CanvasBoard as a generic scaffold (title + tone + close ✕). But §F3
   header ACTIONS — status/lang chip, End-session, project pill — are
   widget-dependent and derive from state the widget owns (for the
   interpreter: the live session snapshot, which lives inside the card's
   TranslateSessionProvider, a different subtree than the header).

   This context bridges the two: the active widget's fullview body
   PUBLISHES its header slot content up, and CanvasBoard's FullviewHeader
   SUBSCRIBES and renders it. Same idiomatic publish-up pattern as
   widget-state / realtime-transcript / translate-session — the provider
   sits above both the surface cards and the shell header so a portaled
   body can feed the header without CanvasBoard knowing widget internals.

   Split publisher/subscriber contexts so the publisher never re-renders
   on slot changes — only the header (subscriber) does.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export type FullviewHeaderSlot = {
  // Sits next to the title (left flex-1 area) — the CD §F3 project pill. The
  // widget owns its behavior (interactive picker vs display-only), the shell
  // just gives it the title-adjacent slot.
  projectPill?: ReactNode;
  // Sits in the status-chip position (right of title/project pill). For the
  // interpreter this is the CD lang pill (Korean → English).
  statusChip?: ReactNode;
  // Right-aligned actions (e.g. End-session). Rendered left of the close ✕.
  actions?: ReactNode;
};

const EMPTY: FullviewHeaderSlot = {};

const SlotCtx = createContext<FullviewHeaderSlot>(EMPTY);
const PublishCtx = createContext<(slot: FullviewHeaderSlot) => void>(() => {});

export function FullviewHeaderSlotProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<FullviewHeaderSlot>(EMPTY);
  return (
    <PublishCtx.Provider value={setSlot}>
      <SlotCtx.Provider value={slot}>{children}</SlotCtx.Provider>
    </PublishCtx.Provider>
  );
}

// Subscriber — CanvasBoard's FullviewHeader reads the active widget's slot.
export function useFullviewHeaderSlot(): FullviewHeaderSlot {
  return useContext(SlotCtx);
}

// Publisher — a widget fullview body pushes its header slot up. No-op when
// no provider is mounted, so bodies stay safe outside the canvas shell.
export function useFullviewHeaderSlotPublisher(): (
  slot: FullviewHeaderSlot,
) => void {
  return useContext(PublishCtx);
}
