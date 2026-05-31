'use client';

// Voice Concierge — global provider mounted once in (app)/layout.tsx.
//
// PR2 rewrites the PR1 stub into a real state machine backed by
// useRealtimeSession (which owns the mic + RealtimeAgent + RealtimeSession
// lifecycle).
//
// PR3 wires two new things on top of PR2:
//   1. Tools — we now hand the hook a router + toast + localized copy so
//      it can bind those into the buildVoiceTools() factory.
//   2. Context sync — usePathname() is captured and on every change the
//      provider debounces 500ms then asks the hook to resync the
//      session's instructions with the new route. Skipped if the route
//      didn't actually change.

import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PREVIEW_FEATURES } from '@/lib/features';
import { useToast } from '@/components/toast-provider';
import { VoiceConciergeFab } from './fab';
import { VoiceConciergePanel } from './panel';
import { useRealtimeSession, type VoiceState } from './use-realtime-session';
import { HighlightOverlay } from './highlight-overlay';

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

/** ms to wait after a route change before pushing fresh instructions.
 *  Per design §2.3 — debounce to avoid spamming the model on rapid SPA
 *  navigations (sidebar tab-flipping etc.). */
const ROUTE_RESYNC_DEBOUNCE_MS = 500;

export function VoiceConciergeProvider({
  children,
  showPreviewFeatures,
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '/dashboard';
  const router = useRouter();
  const localeRaw = useLocale();
  const locale: 'ko' | 'en' = localeRaw === 'en' ? 'en' : 'ko';

  // Toast + tool-status copy threaded into the tool factory. We resolve
  // these here (provider lives under ToastProvider in (app)/layout.tsx)
  // so the hook stays framework-agnostic.
  const toast = useToast();
  const t = useTranslations('Concierge');
  const toolCopy = useMemo(
    () => ({
      navigating: t('tool_navigating'),
      openingPurchase: t('tool_opening_purchase'),
      escalating: t('tool_escalating'),
      highlightFallback: t('tool_highlight_fallback'),
    }),
    [t],
  );

  const session = useRealtimeSession({
    router,
    toast: toast.push,
    toolCopy,
  });

  // PR4 Bundle 1: decide whether to ask the model for a proactive
  // greeting on connect. We can't share useState with the FAB (separate
  // hook instances), so we ref-capture the value at click time from
  // localStorage directly. The FAB also writes the same key so the cue
  // disappears after the first open even if the user closes the panel
  // without connecting.
  const greetOnNextStartRef = useRef(false);

  // Whenever the panel opens, start a fresh realtime session. Closing
  // the panel tears it down. We intentionally don't keep the session
  // alive across closes — quota counts down by duration, and a dormant
  // session is wasteful.
  const openConcierge = useCallback(() => {
    // PR4 Bundle 1: capture whether this is a first-time open BEFORE
    // anything else mutates localStorage. The FAB also writes the seen
    // flag during the same click, but the FAB and provider both call
    // this captures from the same event-loop turn so reading here is
    // deterministic.
    try {
      const seen = window.localStorage.getItem('voice_concierge_intro_seen');
      greetOnNextStartRef.current = seen !== 'seen';
      // Write the seen flag here too — defense in depth against the FAB
      // path being bypassed (e.g. external open from a future deep link).
      window.localStorage.setItem('voice_concierge_intro_seen', 'seen');
    } catch {
      greetOnNextStartRef.current = false;
    }
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
  // useLocale are captured at click time — the entry route is what the
  // initial instructions render around. Subsequent route changes are
  // handled by the resync effect below.
  useEffect(() => {
    if (!open) return;
    if (session.state !== 'idle' && session.state !== 'error') return;
    void session.start(pathname, locale, {
      greet: greetOnNextStartRef.current,
    });
    // Consume the one-shot flag so a manual close/reopen in the same
    // tab doesn't re-trigger the greeting.
    greetOnNextStartRef.current = false;
    // We intentionally do not re-trigger on pathname/locale changes —
    // the entry context is captured once per panel open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── PR3: route → resync ─────────────────────────────────────────────
  //
  // Track the last route we synced so we can skip no-op renders. We also
  // hold a single timer ref so rapid navigations collapse to one resync.
  const lastSyncedRouteRef = useRef<string | null>(null);
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only resync once we actually have a live session.
    if (session.state !== 'live') return;
    // First time the session is live we record the entry route so we
    // don't immediately POST a no-op resync for the same path.
    if (lastSyncedRouteRef.current === null) {
      lastSyncedRouteRef.current = pathname;
      return;
    }
    if (lastSyncedRouteRef.current === pathname) return;

    if (resyncTimerRef.current) {
      clearTimeout(resyncTimerRef.current);
    }
    const route = pathname;
    resyncTimerRef.current = setTimeout(() => {
      lastSyncedRouteRef.current = route;
      void session.resyncInstructions(route, locale);
    }, ROUTE_RESYNC_DEBOUNCE_MS);

    return () => {
      if (resyncTimerRef.current) {
        clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = null;
      }
    };
  }, [pathname, locale, session]);

  // Reset the synced-route tracker when the session is torn down so the
  // next open re-anchors to whatever route we're on then.
  useEffect(() => {
    if (session.state === 'idle') {
      lastSyncedRouteRef.current = null;
    }
  }, [session.state]);

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
              onClose={closeConcierge}
            />
          )}
          {/* PR4 Bundle 4: global listener for highlightUI tool calls. */}
          <HighlightOverlay />
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
