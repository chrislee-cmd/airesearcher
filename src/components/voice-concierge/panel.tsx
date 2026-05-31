'use client';

// Voice Concierge — compact inline speech box at the top-right.
//
// Replaces the previous bottom-right expand panel. The new surface is
// designed to feel like a passive speech bubble rather than a chat panel:
// it sits beside (to the left of) the FAB at the top-right of the
// viewport and shows only the assistant's most recent output, clamped to
// two lines. The user's own utterances are NOT echoed back — keeping the
// surface unobtrusive while live.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { VoiceState, VoiceTranscript } from './use-realtime-session';

// Typewriter speed for the streaming caption (ms between characters).
// The Agents SDK delivers `history_updated` with the *complete* transcript
// once the assistant finishes speaking — there's no per-token delta. So we
// synthesise a streaming feel by revealing one char every ~22ms (≈45 chars/s,
// a touch faster than natural Korean speech so the text doesn't lag the
// audio). Reset whenever a new assistant item id appears.
const TYPEWRITER_MS_PER_CHAR = 22;

type Props = {
  state: VoiceState;
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
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

  // Only show the most recent assistant utterance — the box is a
  // speech bubble, not a transcript log.
  const latestAssistant = [...transcripts]
    .reverse()
    .find((tr) => tr.role === 'assistant');

  const targetText = latestAssistant?.text ?? '';
  const targetId = latestAssistant?.id ?? null;

  // Typewriter-style reveal so the user can actually read from the start
  // even though the SDK hands us the full transcript at once. We track
  // (a) which assistant item we're currently revealing — id change wipes
  // the buffer; (b) how many chars are revealed so far. The advance
  // effect re-arms with setTimeout after every paint, so React's batching
  // keeps DOM updates cheap.
  const [revealed, setRevealed] = useState('');
  const revealedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (targetId !== revealedIdRef.current) {
      revealedIdRef.current = targetId;
      setRevealed('');
    }
  }, [targetId]);

  useEffect(() => {
    if (!targetText) return;
    if (revealed.length >= targetText.length) return;
    const id = setTimeout(() => {
      setRevealed(targetText.slice(0, revealed.length + 1));
    }, TYPEWRITER_MS_PER_CHAR);
    return () => clearTimeout(id);
  }, [revealed, targetText]);

  // When there's no assistant line yet, show a short status hint instead
  // so the box never collapses to empty.
  const bodyText = revealed || stateText;

  // Auto-scroll the caption container so the latest revealed character
  // stays visible. With the typewriter reveal, the box fills naturally:
  // 1 line at first, then 2 lines, then text rolls up past the top edge
  // exactly like a streaming prompt.
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
