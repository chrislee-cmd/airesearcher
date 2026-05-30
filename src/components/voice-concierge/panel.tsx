'use client';

// Voice Concierge — expand panel that shows the live captions and state.
//
// PR2 shipped the bottom-right floating card. PR4 adds:
//   - Bundle 2: mobile fullscreen sheet via Tailwind responsive classes
//     (mobile-first defaults, `sm:` overrides reapply the desktop float).
//   - Bundle 3: text-mode footer (input + send) that engages either on
//     mic_denied (auto) or when the user clicks the keyboard toggle.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { VoiceState, VoiceTranscript } from './use-realtime-session';

type Props = {
  state: VoiceState;
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
  isAssistantSpeaking: boolean;
  muted: boolean | null;
  /** PR4 Bundle 3: true if the panel should render text input alongside
   *  (or instead of) the voice flow. */
  textMode: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  /** PR4 Bundle 3: submit a typed message to the live session. */
  onSendText: (text: string) => void;
  /** PR4 Bundle 3: flip between voice and text-only. */
  onSetTextMode: (next: boolean) => void;
};

export function VoiceConciergePanel({
  state,
  errorKey,
  transcripts,
  isAssistantSpeaking,
  muted,
  textMode,
  onClose,
  onToggleMute,
  onSendText,
  onSetTextMode,
}: Props) {
  const t = useTranslations('Concierge');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  // Auto-scroll to the bottom every time a new caption arrives. Cheap —
  // we only ever render last-20 messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcripts]);

  // ── State indicator copy ──────────────────────────────────────────────
  // When we're in textMode with a mic_denied banner, we render a tooltip
  // ABOVE the input rather than blocking the panel with a hard error state.
  // So the dot stays "live" if we're connected — only true errors flip it.
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

  // Pulse the indicator dot only while audio is flowing.
  const dotClass =
    state === 'live'
      ? isAssistantSpeaking
        ? 'animate-pulse bg-amore'
        : 'bg-amore'
      : state === 'error'
        ? 'bg-warn'
        : 'bg-mute-soft';

  const youLabel = t('you_label');
  const mochiLabel = t('mochi_label');

  // Show the mic-denied banner above the input only when we're in textMode
  // because the mic call failed — not when the user manually toggled in.
  const showMicDeniedBanner = textMode && errorKey === 'mic_denied';

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    onSendText(text);
    setDraft('');
  }

  return (
    <div
      role="dialog"
      aria-label={t('panel_title')}
      className={
        // Mobile (default): fullscreen sheet. inset-0 = covers viewport,
        // no shadow/radius, the user can dismiss with the bigger close
        // button in the header. The keyboard sits naturally below the
        // text input footer.
        // sm: and up — restore the bottom-right floating card. Heights
        // diverge so we use Tailwind h-* utilities instead of a `style`
        // prop (style attr can't be made responsive).
        'fixed inset-0 z-[85] flex flex-col border-line bg-paper ' +
        'sm:bottom-24 sm:right-5 sm:left-auto sm:top-auto sm:h-[520px] sm:w-[360px] ' +
        'sm:border sm:shadow-[0_2px_8px_rgba(0,0,0,0.04)] sm:[border-radius:14px]'
      }
    >
      {/* Header — larger close hit area on mobile (44×44 thumb target). */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:py-3">
        <span className="text-[15px] font-medium text-ink sm:text-[13px]">
          {t('panel_title')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className={
            // Thumb-friendly mobile (44×44); compact desktop (auto).
            'flex h-11 w-11 items-center justify-center text-mute-soft ' +
            'transition-colors duration-[120ms] hover:text-ink-2 ' +
            'sm:h-auto sm:w-auto'
          }
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sm:[width:18px] sm:[height:18px]">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* State indicator */}
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 [border-radius:9999px] ${dotClass}`}
        />
        <span className="text-[12px] text-mute">{stateText}</span>
      </div>

      {/* Captions — flex-1 so they expand to fill the column. Larger text
          on mobile for thumb-readability. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {transcripts.length === 0 ? (
          <p className="text-[14px] text-mute-soft sm:text-[12.5px]">
            {state === 'live' ? t('state_listening') : t('state_idle')}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {transcripts.map((tr) => (
              <li key={tr.id} className="text-[15px] leading-[1.5] sm:text-[13px] sm:leading-[1.45]">
                <span className="mr-1.5 text-[11.5px] uppercase tracking-[0.08em] text-mute-soft">
                  {tr.role === 'user' ? youLabel : mochiLabel}
                </span>
                <span className="text-ink-2">{tr.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mic-denied banner — appears above the text input only when text
          mode engaged because the mic call failed. */}
      {showMicDeniedBanner && (
        <div className="border-t border-line-soft bg-paper-soft px-4 py-2 text-[12px] text-mute">
          {t('text_mode_mic_denied_hint')}
        </div>
      )}

      {/* Text input footer — Bundle 3. Only rendered while textMode is on. */}
      {textMode && (
        <form
          className="flex items-center gap-2 border-t border-line-soft px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submitDraft();
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('text_mode_placeholder')}
            aria-label={t('text_mode_placeholder')}
            className={
              'flex-1 border border-line bg-paper px-3 py-2 text-[14px] ' +
              'text-ink-2 placeholder:text-mute-soft focus:border-amore ' +
              'focus:outline-none [border-radius:8px] sm:text-[13px]'
            }
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className={
              'flex h-11 w-11 items-center justify-center border border-line ' +
              'bg-paper text-ink-2 transition-colors duration-[120ms] ' +
              'hover:border-amore hover:text-amore disabled:cursor-not-allowed ' +
              'disabled:opacity-40 [border-radius:8px] sm:h-9 sm:w-9'
            }
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </svg>
          </button>
        </form>
      )}

      {/* Footer — mute toggle + voice/text mode switch.
          Mute is hidden in textMode (the mic is silenced anyway). */}
      {state === 'live' && (
        <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onClick={() => onSetTextMode(!textMode)}
            aria-label={
              textMode
                ? t('text_mode_toggle_to_voice')
                : t('text_mode_toggle_to_text')
            }
            className={
              'flex h-11 items-center gap-1.5 text-[11.5px] uppercase tracking-[0.08em] ' +
              'text-mute-soft transition-colors duration-[120ms] hover:text-ink-2 sm:h-auto'
            }
          >
            <span aria-hidden="true">{textMode ? '🎙' : '⌨'}</span>
            <span>
              {textMode
                ? t('text_mode_toggle_to_voice')
                : t('text_mode_toggle_to_text')}
            </span>
          </button>
          {!textMode && muted !== null && (
            <button
              type="button"
              onClick={onToggleMute}
              className="flex h-11 items-center text-[11.5px] uppercase tracking-[0.08em] text-mute-soft transition-colors duration-[120ms] hover:text-ink-2 sm:h-auto"
            >
              {muted ? 'unmute' : 'mute'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
