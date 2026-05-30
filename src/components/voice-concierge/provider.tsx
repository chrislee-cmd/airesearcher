'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { PREVIEW_FEATURES } from '@/lib/features';
import { VoiceConciergeFab } from './fab';

// Lifecycle (PR1 stub):
//   idle      → FAB visible, nothing connected. The only state we ship.
// PR2 will add: connecting | listening | speaking | error.
type VoiceConciergeStatus = 'idle';

type Ctx = {
  open: boolean;
  status: VoiceConciergeStatus;
  openConcierge: () => void;
  closeConcierge: () => void;
};

const VoiceConciergeCtx = createContext<Ctx | null>(null);

type Props = {
  children: React.ReactNode;
  // Mirrors the sidebar's `showPreviewFeatures` prop — the (app) layout
  // resolves `flags.isUnlimited` once on the server and passes it down,
  // so we don't re-fetch org flags on every navigation.
  showPreviewFeatures: boolean;
};

// Global voice concierge mount. Lives in (app)/layout.tsx — keeping it
// out of any route segment means SPA navigation never unmounts the
// session (when PR2 adds the live WebRTC connection, that property
// becomes load-bearing).
//
// PR1 ships the foundation only: a PREVIEW-gated FAB that pops a
// "coming soon" toast on click. No mic permission request, no OpenAI
// connection, no transcript writes.
export function VoiceConciergeProvider({
  children,
  showPreviewFeatures,
}: Props) {
  const [open, setOpen] = useState(false);
  // Status is hard-pinned to 'idle' in PR1; declared as state so PR2 can
  // promote it to a setter without rewriting the context surface.
  const [status] = useState<VoiceConciergeStatus>('idle');

  const openConcierge = useCallback(() => setOpen(true), []);
  const closeConcierge = useCallback(() => setOpen(false), []);

  const value = useMemo<Ctx>(
    () => ({ open, status, openConcierge, closeConcierge }),
    [open, status, openConcierge, closeConcierge],
  );

  // Preview gate — keep the FAB invisible for normal orgs until the
  // feature graduates out of PREVIEW_FEATURES. We still mount the
  // provider (so any future consumer hooks resolve without throwing),
  // we just don't paint the FAB.
  const fabVisible =
    showPreviewFeatures && PREVIEW_FEATURES.has('voice_concierge');

  return (
    <VoiceConciergeCtx.Provider value={value}>
      {children}
      {fabVisible && <VoiceConciergeFab />}
    </VoiceConciergeCtx.Provider>
  );
}

export function useVoiceConcierge(): Ctx {
  const ctx = useContext(VoiceConciergeCtx);
  if (!ctx) {
    throw new Error(
      'useVoiceConcierge must be used inside <VoiceConciergeProvider>',
    );
  }
  return ctx;
}
