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
import { useFirstTimeFlag } from './first-time';
import { useVoiceConcierge } from './provider';

export function VoiceConciergeFab() {
  const t = useTranslations('Concierge');
  const { open, status, toggleConcierge } = useVoiceConcierge();
  const { isFirstTime, markSeen } = useFirstTimeFlag();

  // Subtle visual cue while connected. We keep this minimal in PR2 (a
  // border colour swap) — the panel itself shows the listening/speaking
  // state, the FAB just needs to read as "active".
  const isActive = open || status === 'live' || status === 'connecting';

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
      {/* First-time tooltip — positioned above the FAB, dismisses on
          FAB click (via markSeen in handleClick) OR opt-out button. */}
      {showFirstTimeCue && (
        <div
          // Above the FAB (fixed bottom-5 right-5, FAB h-14) plus an 8px gap.
          // We render as a sibling of the FAB so click-through behavior is
          // explicit per element. Same z-layer as the FAB itself.
          className={
            'fixed bottom-[88px] right-5 z-[80] flex items-center gap-2 ' +
            'border border-line bg-paper px-3 py-2 text-[12px] text-ink-2 ' +
            'shadow-[0_2px_8px_rgba(0,0,0,0.06)] [border-radius:10px]'
          }
          role="status"
        >
          <span>{t('first_time_tooltip')}</span>
          <button
            type="button"
            onClick={handleDismissTooltip}
            aria-label={t('first_time_dismiss')}
            className="text-[11px] text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            {t('first_time_dismiss')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleClick}
        title={t('fab_tooltip')}
        aria-label={t('fab_tooltip')}
        aria-pressed={isActive}
        className={
          'fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center ' +
          'justify-center border bg-paper transition-colors duration-[120ms] ' +
          '[border-radius:9999px] ' +
          (showFirstTimeCue
            ? 'ring-2 ring-amore/40 animate-pulse border-amore text-amore '
            : '') +
          (isActive
            ? 'border-amore text-amore'
            : showFirstTimeCue
              ? ''
              : 'border-line text-ink-2 hover:border-amore hover:text-amore')
        }
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </button>
    </>
  );
}
