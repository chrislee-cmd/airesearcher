'use client';

// Voice Concierge — compact inline speech box at the top-right.
//
// Replaces the previous bottom-right expand panel. The new surface is
// designed to feel like a passive speech bubble rather than a chat panel:
// it sits beside (to the left of) the FAB at the top-right of the
// viewport and shows only the assistant's most recent output, clamped to
// two lines. The user's own utterances are NOT echoed back — keeping the
// surface unobtrusive while live.

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton } from '../ui/icon-button';
import type { VoiceState, VoiceTranscript } from './use-realtime-session';

type Props = {
  state: VoiceState;
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
  /** Live assistant caption accumulated from raw transport deltas. When
   *  non-null this takes precedence over the completed transcript list
   *  because it updates in real time with TTS generation. */
  streamingAssistant: VoiceTranscript | null;
  isAssistantSpeaking: boolean;
  /** Smoothed mic level (0..1) — drives the input feedback dot so the
   *  user can see their own voice landing while the assistant pauses. */
  inputLevel: number;
  onClose: () => void;
};

export function VoiceConciergePanel({
  state,
  errorKey,
  transcripts,
  streamingAssistant,
  isAssistantSpeaking,
  inputLevel,
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

  // Detect "user is currently speaking" from the smoothed mic level —
  // any sustained signal above the noise floor counts. We don't try to
  // do real VAD; the threshold is generous enough that breath/typing
  // doesn't trigger and quiet speech does.
  const isUserSpeaking = state === 'live' && inputLevel > 0.06;

  const baseDotClass =
    state === 'live'
      ? isAssistantSpeaking
        ? 'animate-pulse bg-amore'
        : 'bg-amore'
      : state === 'error'
        ? 'bg-warn'
        : 'bg-mute-soft';

  // Scale the dot with the live mic level — gives a real-time "I hear
  // you" pulse while the user speaks, without adding a separate widget.
  // Capped low so the dot stays inside its 8×8 slot.
  const dotScale = isUserSpeaking ? 1 + Math.min(0.9, inputLevel * 1.4) : 1;

  // Prefer the live streaming caption (raw transport deltas) when we
  // have one — it lands in lock-step with TTS generation. Fall back to
  // the last completed assistant message from the SDK history if for
  // some reason deltas weren't emitted (e.g. text-only response). This
  // keeps the box populated across all code paths.
  const completedAssistant = [...transcripts]
    .reverse()
    .find((tr) => tr.role === 'assistant');
  const display = streamingAssistant ?? completedAssistant ?? null;

  // When there's no assistant line yet, show a short status hint instead
  // so the box never collapses to empty.
  const bodyText = display?.text || stateText;

  // Auto-scroll the caption container so the latest fragment stays
  // visible. Each transport delta widens display.text by ~a token, so
  // the box fills naturally: 1 line at first, then 2 lines, then text
  // rolls up past the top edge exactly like a streaming prompt.
  const captionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bodyText]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('panel_title')}
      className={
        // Sit to the left of the FAB at top-right. FAB is now 40px wide
        // (top-5 right-5) → leave a 12px gutter and anchor the box to
        // right-[64px]. Width is fluid but capped so long lines wrap
        // into a second row before reaching the screen edge.
        'fixed top-5 right-[64px] z-[80] flex max-w-[360px] items-start gap-3 ' +
        'border border-line bg-paper px-3.5 py-2.5 ' +
        'shadow-[0_2px_8px_rgba(0,0,0,0.04)] [border-radius:10px]'
      }
    >
      {/* Dot reflects state colour AND pulses with the mic level when
          the user is speaking. transform-scale keeps it cheap (no
          reflow) and the parent slot is fixed at 8×8 so it never
          pushes the text. */}
      <span
        aria-hidden="true"
        style={{
          transform: `scale(${dotScale.toFixed(2)})`,
          transition: 'transform 80ms ease-out',
        }}
        className={`mt-1.5 inline-block h-2 w-2 shrink-0 [border-radius:9999px] ${baseDotClass}`}
      />
      {/* Fixed-height streaming window — at most two lines (13px × 1.45
          line-height ≈ 19px → ~38px). As the assistant deltas pour in,
          the inner paragraph grows and the auto-scroll effect pins the
          tail to the bottom, so the user always sees the freshest text
          like a streaming prompt. Scrollbar is hidden on both engines
          so nothing visually leaks into the speech-bubble feel. */}
      <div
        ref={captionRef}
        className={
          'flex-1 overflow-y-auto text-[13px] leading-[1.45] text-ink-2 ' +
          'max-h-[38px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        }
      >
        <p className="whitespace-pre-wrap break-words">{bodyText}</p>
      </div>
      <IconButton
        onClick={onClose}
        aria-label={t('close')}
        className="shrink-0 self-start"
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
      </IconButton>
    </div>
  );
}
