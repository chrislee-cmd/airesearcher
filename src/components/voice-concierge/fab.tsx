'use client';

import { useTranslations } from 'next-intl';
import { useToast } from '../toast-provider';

// Bottom-right floating mic button. PR1 stub — click only shows a toast.
// Visual matches the editorial design tokens (border-line / bg-paper /
// 14px border-radius — same as the toast cards and background-job-pill
// accents) so the FAB doesn't look out of place when it appears for
// super-admin orgs.
//
// PR2 will wire: mic permission request → OpenAI Realtime WebRTC →
// expand panel with captions + waveform. PR4 will swap this for a
// bottom-sheet on mobile.
export function VoiceConciergeFab() {
  const t = useTranslations('Concierge');
  const toast = useToast();

  const handleClick = () => {
    toast.push(t('coming_soon'), { tone: 'amore' });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={t('fab_tooltip')}
      aria-label={t('fab_tooltip')}
      className={
        // Fixed position above the workspace panel hand-off zone but well
        // clear of typical content. z-[80] sits below the toast layer
        // (z-[90]) so toasts stack on top of the FAB when it's pressed.
        'fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center ' +
        'justify-center border border-line bg-paper text-ink-2 ' +
        'transition-colors duration-[120ms] hover:border-amore hover:text-amore ' +
        '[border-radius:9999px]'
      }
    >
      {/* Inline SVG so we don't pull in an icon dependency. Simple mic
          glyph — outline only to match the editorial 1px-border style. */}
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
