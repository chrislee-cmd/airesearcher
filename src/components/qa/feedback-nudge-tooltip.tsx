'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';

// FeedbackNudgeTooltip — wraps the QA voice (🎤) button in a relative anchor and
// floats a one-shot callout below it to nudge feedback submissions. It is NOT
// the hover Tooltip primitive (ui/tooltip.tsx): this is an automatic, timed
// callout, so it owns its own anchoring + CSS-keyframe motion (globals.css:
// feedbackNudge*) — no new dependency.
//
// Flow (spec §A): mount → wait ~0.8s → appear → hold ~5s → fade out. Any of
// {5s timeout, clicking the wrapped button, the ✕ close} dismisses it and sets
// a sessionStorage flag so it shows at most ONCE per session (survives client
// navigation, re-appears in a fresh session). prefers-reduced-motion is honored
// by the CSS (motion off, show/hide only).
//
// Because the mic button sits in the Topbar's top-right, the callout opens
// DOWN-LEFT (top-full, right-0) with an upward caret so it points back at 🎤 and
// never runs off the right edge. pointer-events are limited to the ✕ so the
// callout never intercepts clicks meant for the button or the page beneath.

const SESSION_FLAG = 'qa-feedback-nudge-seen';
const APPEAR_DELAY_MS = 800;
const VISIBLE_MS = 5000;
// Matches feedbackNudgeOut duration (var(--dur-fast) = 120ms) with headroom.
const EXIT_MS = 200;

type Phase = 'hidden' | 'in' | 'out';

export function FeedbackNudgeTooltip({ children }: { children: ReactNode }) {
  const t = useTranslations('QaFeedback');
  const [phase, setPhase] = useState<Phase>('hidden');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dismissedRef = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Fade out then unmount, and remember we've shown it this session so it never
  // re-appears on navigation. Idempotent — repeated triggers (timeout racing a
  // click) collapse to one dismissal.
  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearTimers();
    try {
      sessionStorage.setItem(SESSION_FLAG, '1');
    } catch {
      // sessionStorage can throw (private mode / disabled) — best-effort flag.
    }
    setPhase('out');
    timers.current.push(setTimeout(() => setPhase('hidden'), EXIT_MS));
  }, [clearTimers]);

  useEffect(() => {
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem(SESSION_FLAG) === '1';
    } catch {
      alreadySeen = false;
    }
    if (alreadySeen) return;

    timers.current.push(
      setTimeout(() => {
        setPhase('in');
        timers.current.push(setTimeout(dismiss, VISIBLE_MS));
      }, APPEAR_DELAY_MS),
    );

    return clearTimers;
  }, [dismiss, clearTimers]);

  // A click/press anywhere on the wrapped button counts as engagement → dismiss
  // immediately (capture so it fires before the button's own handler). We only
  // dismiss; the button's real behavior (start recording) proceeds untouched.
  const onButtonInteract = useCallback(() => {
    if (phase !== 'hidden') dismiss();
  }, [phase, dismiss]);

  return (
    <span
      className="relative inline-flex"
      onClickCapture={onButtonInteract}
      onKeyDownCapture={onButtonInteract}
    >
      {children}

      {phase !== 'hidden' && (
        <span
          role="status"
          aria-live="polite"
          className={`pointer-events-none absolute right-0 top-full z-fab mt-2 flex w-56 items-start gap-2 px-3 py-2 ${
            phase === 'out' ? 'feedback-nudge-out' : 'feedback-nudge-in'
          }`}
          style={{
            background: 'var(--sidebar-nav-bg)',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-sm)',
          }}
        >
          {/* Caret pointing back up at the 🎤 button. Bobs to draw the eye
              (feedback-nudge-caret); rotate-45 is the base so reduced-motion
              (animation off) still renders a diamond. */}
          <span
            aria-hidden
            className="feedback-nudge-caret absolute -top-1 right-4 h-2 w-2 rotate-45"
            style={{
              background: 'var(--sidebar-nav-bg)',
              borderTop:
                'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
              borderLeft:
                'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
            }}
          />
          <span className="text-xs font-medium leading-relaxed text-ink">
            {t('nudge')}
          </span>
          <IconButton
            variant="plain"
            size="compact"
            aria-label={t('nudgeDismiss')}
            onClick={dismiss}
            className="pointer-events-auto -mr-1 -mt-0.5 shrink-0 px-1 text-xs text-mute-soft"
          >
            ✕
          </IconButton>
        </span>
      )}
    </span>
  );
}
