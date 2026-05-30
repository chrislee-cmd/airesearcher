'use client';

// Voice Concierge — global provider mounted once in (app)/layout.tsx.
//
// PR2 rewrites the PR1 stub into a real state machine backed by
// useRealtimeSession (which owns the mic + RealtimeAgent + RealtimeSession
// lifecycle). The provider still gates the FAB on the PREVIEW flag, but
// now also renders the expand panel and re-opens / closes the actual
// realtime connection based on `open`.

import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { PREVIEW_FEATURES } from '@/lib/features';
import { VoiceConciergeFab } from './fab';
import { VoiceConciergePanel } from './panel';
import { useRealtimeSession, type VoiceState } from './use-realtime-session';

type Ctx = {
  /** Whether the expand panel is mounted/visible. */
  open: boolean;
  status: VoiceState;
  openConcierge: () => void;
  closeConcierge: () => void;
  toggleConcierge: () => void;
};

const VoiceConciergeCtx = createContext<Ctx | null>(null);

type Props = {
  children: React.ReactNode;
  showPreviewFeatures: boolean;
};

export function VoiceConciergeProvider({
  children,
  showPreviewFeatures,
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '/dashboard';
  const localeRaw = useLocale();
  const locale: 'ko' | 'en' = localeRaw === 'en' ? 'en' : 'ko';

  const session = useRealtimeSession();

  // Whenever the panel opens, start a fresh realtime session. Closing
  // the panel tears it down. We intentionally don't keep the session
  // alive across closes — quota counts down by duration, and a dormant
  // session is wasteful.
  const openConcierge = useCallback(() => {
    setOpen(true);
  }, []);
  const closeConcierge = useCallback(() => {
    setOpen(false);
    void session.stop();
  }, [session]);
  const toggleConcierge = useCallback(() => {
    if (open) closeConcierge();
    else openConcierge();
  }, [open, openConcierge, closeConcierge]);

  // Kick off the connection right after the panel becomes visible so the
  // user sees the "connecting" indicator immediately. usePathname /
  // useLocale are captured at click time, which is what we want — even
  // if the user SPA-navigates mid-session the agent's instructions stay
  // pinned to the entry route (PR3 will add session.update on nav).
  useEffect(() => {
    if (!open) return;
    if (session.state !== 'idle' && session.state !== 'error') return;
    void session.start(pathname, locale);
    // We intentionally do not re-trigger on pathname/locale changes —
    // the entry context is captured once per panel open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const value = useMemo<Ctx>(
    () => ({
      open,
      status: session.state,
      openConcierge,
      closeConcierge,
      toggleConcierge,
    }),
    [open, session.state, openConcierge, closeConcierge, toggleConcierge],
  );

  const fabVisible =
    showPreviewFeatures && PREVIEW_FEATURES.has('voice_concierge');

  return (
    <VoiceConciergeCtx.Provider value={value}>
      {children}
      {fabVisible && (
        <>
          <VoiceConciergeFab />
          {open && (
            <VoiceConciergePanel
              state={session.state}
              errorKey={session.errorKey}
              transcripts={session.transcripts}
              isAssistantSpeaking={session.isAssistantSpeaking}
              muted={session.muted}
              onClose={closeConcierge}
              onToggleMute={session.toggleMute}
            />
          )}
        </>
      )}
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
