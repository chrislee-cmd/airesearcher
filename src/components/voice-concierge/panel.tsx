'use client';

// Voice Concierge — compact inline speech box at the top-right.
//
// Replaces the previous bottom-right expand panel. The new surface is
// designed to feel like a passive speech bubble rather than a chat panel:
// it sits beside (to the left of) the FAB at the top-right of the
// viewport and shows only the assistant's most recent output, clamped to
// two lines. The user's own utterances are NOT echoed back — keeping the
// surface unobtrusive while live.

import { useTranslations } from 'next-intl';
import type { VoiceState, VoiceTranscript } from './use-realtime-session';

type Props = {
  state: VoiceState;
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
  isAssistantSpeaking: boolean;
  onClose: () => void;
};

export function VoiceConciergePanel({
  state,
  errorKey,
  transcripts,
  isAssistantSpeaking,
  onClose,
}: Props) {
  const t = useTranslations('Concierge');

  let stateText: string;
  if (state === 'error') {
    if (errorKey === 'quota_exceeded') stateText = t('quota_exceeded');
    else stateText = t('state_error');
  } else if (state === 'requesting-mic' || state === 'connecting') {
    stateText = t('state_connecting');
  } else if (state === 'ending') {
    stateText = t('state_connecting');
  } else if (state === 'live') {
    stateText = isAssistantSpeaking ? t('state_speaking') : t('state_listening');
  } else {
    stateText = t('state_idle');
  }

  const dotClass =
    state === 'live'
      ? isAssistantSpeaking
        ? 'animate-pulse bg-amore'
        : 'bg-amore'
      : state === 'error'
        ? 'bg-warn'
        : 'bg-mute-soft';

  // Only show the most recent assistant utterance — the box is a
  // speech bubble, not a transcript log.
  const latestAssistant = [...transcripts]
    .reverse()
    .find((tr) => tr.role === 'assistant');

  // When there's no assistant line yet, show a short status hint instead
  // so the box never collapses to empty.
  const bodyText = latestAssistant?.text ?? stateText;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('panel_title')}
      className={
        // Sit to the left of the FAB at top-right. FAB is fixed
        // top-5 right-5, 56px wide → leave 12px gutter, anchor the box
        // to right-[84px]. Width is fluid but capped so long lines wrap
        // into a second row before reaching the screen edge on small
        // viewports.
        'fixed top-5 right-[84px] z-[80] flex max-w-[360px] items-start gap-3 ' +
        'border border-line bg-paper px-3.5 py-2.5 ' +
        'shadow-[0_2px_8px_rgba(0,0,0,0.04)] [border-radius:10px]'
      }
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 inline-block h-2 w-2 shrink-0 [border-radius:9999px] ${dotClass}`}
      />
      <p
        className={
          // line-clamp-2 keeps the box to at most two lines; anything
          // longer truncates with an ellipsis, which is fine because
          // the model speaks the full line aloud anyway.
          'flex-1 text-[13px] leading-[1.45] text-ink-2 ' +
          '[display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden'
        }
      >
        {bodyText}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('close')}
        className={
          'shrink-0 self-start text-mute-soft transition-colors duration-[120ms] hover:text-ink-2'
        }
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
