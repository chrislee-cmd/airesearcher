'use client';

// Voice Concierge floating action button.
//
// PR1 stubbed the click to a toast. PR2 wires it to toggle the expand
// panel via VoiceConciergeProvider — the actual mic permission request
// and OpenAI Realtime connect fire from the panel-open effect.
//
// PR4 Bundle 1: first-time pulse + soft greeting.
//   - While useFirstTimeFlag().isFirstTime is true AND the panel is
//     closed, the FAB gets a subtle ring-pulse and a one-line tooltip
//     ("처음이세요? 눌러주세요") rendered just above it.
//   - On any FAB click, markSeen() is called (so the cue disappears
//     forever). The tooltip also offers an explicit "다음부터 안 보이게"
//     opt-out that dismisses without opening the panel.
//   - The provider reads isFirstTime to decide whether the model should
//     greet the user proactively after connect.

import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import { useFirstTimeFlag } from './first-time';
import { useVoiceConcierge } from './provider';

export function VoiceConciergeFab() {
  const t = useTranslations('Concierge');
  const { open, status, isAssistantSpeaking, inputLevel, toggleConcierge } =
    useVoiceConcierge();
  const { isFirstTime, markSeen } = useFirstTimeFlag();

  // Subtle visual cue while connected. We keep this minimal in PR2 (a
  // border colour swap) — the panel itself shows the listening/speaking
  // state, the FAB just needs to read as "active".
  const isActive = open || status === 'live' || status === 'connecting';

  // Input-driven outer ring. Scales (1 → ~1.55) and fades in with the
  // smoothed mic level so the user can see their voice landing without
  // needing to look at the inline box. Capped to a sensible max so loud
  // talkers don't smash into the viewport edge.
  const ringScale = 1 + Math.min(0.55, inputLevel * 0.9);
  const ringOpacity = Math.min(0.55, 0.1 + inputLevel * 0.9);
  const showInputRing = status === 'live' && inputLevel > 0.04;

  // Only show the cue when the panel is closed and the user hasn't seen
  // the intro before. Once the panel opens for the first time (or the
  // user opts out), both conditions go false and the pulse disappears.
  const showFirstTimeCue = isFirstTime && !open;

  const handleClick = () => {
    // IMPORTANT: openConcierge() reads the localStorage 'seen' flag to
    // decide whether to greet proactively. We must call toggleConcierge
    // BEFORE markSeen so the provider sees the pre-click value. The
    // local state update (markSeen) then hides the tooltip on the next
    // render — the order of state vs effect doesn't matter for that.
    toggleConcierge();
    if (isFirstTime) markSeen();
  };

  const handleDismissTooltip = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Opt-out path — must NOT toggle the panel. Stop propagation so the
    // FAB's parent button doesn't also fire on synthetic event bubbling
    // through the absolute-positioned tooltip. We DO write to localStorage
    // here (markSeen does both) because skipping the panel-open means the
    // provider never gets a chance to record "seen".
    e.stopPropagation();
    markSeen();
  };

  return (
    <>
      {/* First-time tooltip — positioned below the FAB (FAB now lives at
          top-right, so the tooltip drops down from it). */}
      {showFirstTimeCue && (
        <div
          className={
            // FAB is now top-5 right-5, h-10 → tooltip drops just below
            // it with an 8px gap (20 + 40 + 8 = 68px from the top).
            'fixed top-[68px] right-5 z-fab flex items-center gap-2 ' +
            'border border-line bg-paper px-3 py-2 text-[12px] text-ink-2 ' +
            'shadow-[0_2px_8px_rgba(0,0,0,0.06)] [border-radius:10px]'
          }
          role="status"
        >
          <span>{t('first_time_tooltip')}</span>
          <Button
            variant="link"
            size="xs"
            onClick={handleDismissTooltip}
            aria-label={t('first_time_dismiss')}
            className="px-0 py-0 text-[11px] font-normal text-mute-soft"
          >
            {t('first_time_dismiss')}
          </Button>
        </div>
      )}

      {/* Container at top-right anchors the input ring + button together
          so we can transform-scale the ring independently of layout. */}
      <div className="fixed top-5 right-5 z-fab flex h-10 w-10 items-center justify-center">
        {/* Input-driven outer ring — only renders while live and the
            user is actually speaking. Pure transform/opacity so it never
            triggers reflow. */}
        {showInputRing && (
          <span
            aria-hidden="true"
            style={{
              transform: `scale(${ringScale.toFixed(3)})`,
              opacity: ringOpacity.toFixed(3),
            }}
            className={
              'pointer-events-none absolute inset-0 [border-radius:9999px] ' +
              'border border-amore transition-[transform,opacity] duration-[80ms] ease-out'
            }
          />
        )}
        {/* Assistant-speaking glow — soft amore halo while the model
            speaks. We layer this UNDER the button so the icon stays crisp. */}
        {isAssistantSpeaking && (
          <span
            aria-hidden="true"
            className={
              'pointer-events-none absolute inset-[-3px] [border-radius:9999px] ' +
              'bg-amore/15 animate-pulse'
            }
          />
        )}
        <button
          type="button"
          onClick={handleClick}
          title={t('fab_tooltip')}
          aria-label={t('fab_tooltip')}
          aria-pressed={isActive}
          className={
            'relative flex h-10 w-10 items-center justify-center border bg-paper ' +
            'transition-colors duration-[120ms] [border-radius:9999px] ' +
            (showFirstTimeCue
              ? 'ring-1 ring-amore/30 border-amore text-amore '
              : '') +
            (isActive
              ? 'border-amore text-amore'
              : showFirstTimeCue
                ? ''
                : 'border-line text-mute hover:border-amore hover:text-amore')
          }
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="9" y1="22" x2="15" y2="22" />
          </svg>
        </button>
      </div>
    </>
  );
}
