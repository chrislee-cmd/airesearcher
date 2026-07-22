'use client';

/* ────────────────────────────────────────────────────────────────────
   TranslateSessionContext — read-only mirror of the live 동시통역 session.

   Why this exists (PR: translate-fullview-session-preserve):
   Opening the shared fullview modal used to MOVE <TranslateConsole> from
   the canvas card into the modal slot. React treats a different tree
   position as a new instance → the card console unmounts → its
   `cleanup('unmount')` tears down the WebRTC / LiveKit / OpenAI Realtime
   session mid-call. The user saw interpretation die the instant they hit
   전체 보기.

   Fix: <TranslateConsole> now stays mounted in the card at all times (it
   OWNS the session), and the fullview renders a separate READ-ONLY view.
   This context is the bridge: the console PUBLISHES a snapshot of the
   render state it already computes (prompter lines / share url / live
   flag / session id), and the read-only fullview view SUBSCRIBES to it.

   The provider must wrap BOTH the console and the fullview portal (they
   are siblings in the card's ExpandedBody), so it lives in translate-card,
   not inside translate-console. Same publish-up shape as the widget-state
   and realtime-transcript providers.

   Split into two contexts so the publisher (console) never re-renders when
   the snapshot changes — only the consumer (fullview view) does.
   ──────────────────────────────────────────────────────────────────── */

import { createContext, useContext, useState, type ReactNode } from 'react';
// Type-only import — erased at compile, so no runtime cycle even though
// translate-console imports this module's publisher hook.
import type { CaptionLine } from '../translate-console';
import type { Listener } from '@/hooks/use-translate-listeners';

export type TranslateSessionSnapshot = {
  // Reactive session id (null until a session goes live). Drives the
  // fullview listener presence hook.
  sessionId: string | null;
  // Public share link (null until the host shares). Shown read-only.
  shareUrl: string | null;
  // Whether interpretation is currently live.
  isLive: boolean;
  // The translated (OUTPUT) prompter lines, already windowed + sorted by
  // the console. Rendered read-only in the fullview OUTPUT panel.
  promptedLines: CaptionLine[];
  // The source-language (INPUT) lines, same rolling window as promptedLines.
  // Interpreter fullview (state 03) renders both streams side-by-side; the
  // console already keeps `inputLines` in state — the fullview twin-panel
  // was the missing consumer (audit gap: snapshot never carried input).
  inputLines: CaptionLine[];
  // Current share-link listeners, derived from presence on the console's
  // own broadcast channel. Mirrored read-only in the fullview.
  listeners: Listener[];
  // Endonym labels of the source / target languages (e.g. 한국어 / English)
  // for the INPUT/OUTPUT panel headers + header lang pill. '' until picked.
  sourceLangLabel: string;
  targetLangLabel: string;
  // Host-local monitor audio toggle. The gain lives in the console; the
  // fullview rail mirrors + flips it via `toggleOutputAudible` (§F4 toggle).
  outputAudible: boolean;
  toggleOutputAudible: () => void;
  // Observer-link copy action + its transient "copied" flag (rail button).
  copyShareUrl: () => void;
  shareCopied: boolean;
  // End-session — mirrors the card's existing stop action (header End-session
  // button). No-op outside a live session.
  stop: () => void;
};

const NOOP = () => {};

const EMPTY: TranslateSessionSnapshot = {
  sessionId: null,
  shareUrl: null,
  isLive: false,
  promptedLines: [],
  inputLines: [],
  listeners: [],
  sourceLangLabel: '',
  targetLangLabel: '',
  outputAudible: false,
  toggleOutputAudible: NOOP,
  copyShareUrl: NOOP,
  shareCopied: false,
  stop: NOOP,
};

const SnapshotCtx = createContext<TranslateSessionSnapshot>(EMPTY);
// setState identity is stable across renders (React guarantee), so the
// console's publish effect keeps a clean dependency list.
const PublishCtx = createContext<(snap: TranslateSessionSnapshot) => void>(
  () => {},
);

export function TranslateSessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<TranslateSessionSnapshot>(EMPTY);
  return (
    <PublishCtx.Provider value={setSnapshot}>
      <SnapshotCtx.Provider value={snapshot}>{children}</SnapshotCtx.Provider>
    </PublishCtx.Provider>
  );
}

// Consumer hook — the read-only fullview view. Returns EMPTY when no
// provider is mounted (e.g. the console running standalone on /live).
export function useTranslateSession(): TranslateSessionSnapshot {
  return useContext(SnapshotCtx);
}

// Publisher hook — <TranslateConsole> pushes its render snapshot up. No-op
// when no provider is mounted, so the same console code is safe outside the
// canvas.
export function useTranslateSessionPublisher(): (
  snap: TranslateSessionSnapshot,
) => void {
  return useContext(PublishCtx);
}
