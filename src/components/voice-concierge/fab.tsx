'use client';

// Voice Concierge floating action button.
//
// PR1 stubbed the click to a toast. PR2 wires it to toggle the expand
// panel via VoiceConciergeProvider — the actual mic permission request
// and OpenAI Realtime connect fire from the panel-open effect.

import { useTranslations } from 'next-intl';
import { useVoiceConcierge } from './provider';

export function VoiceConciergeFab() {
  const t = useTranslations('Concierge');
  const { open, status, toggleConcierge } = useVoiceConcierge();

  // Subtle visual cue while connected. We keep this minimal in PR2 (a
  // border colour swap) — the panel itself shows the listening/speaking
  // state, the FAB just needs to read as "active".
  const isActive = open || status === 'live' || status === 'connecting';

  return (
    <button
      type="button"
      onClick={toggleConcierge}
      title={t('fab_tooltip')}
      aria-label={t('fab_tooltip')}
      aria-pressed={isActive}
      className={
        'fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center ' +
        'justify-center border bg-paper transition-colors duration-[120ms] ' +
        '[border-radius:9999px] ' +
        (isActive
          ? 'border-amore text-amore'
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
  );
}
