'use client';

// Voice Concierge — expand panel that shows the live captions and state.
// Desktop only for PR2; mobile fullscreen sheet lands in PR4 (design §5.3).

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { VoiceState, VoiceTranscript } from './use-realtime-session';

type Props = {
  state: VoiceState;
  errorKey?: 'mic_denied' | 'quota_exceeded' | 'preview_only' | 'generic';
  transcripts: VoiceTranscript[];
  isAssistantSpeaking: boolean;
  muted: boolean | null;
  onClose: () => void;
  onToggleMute: () => void;
};

export function VoiceConciergePanel({
  state,
  errorKey,
  transcripts,
  isAssistantSpeaking,
  muted,
  onClose,
  onToggleMute,
}: Props) {
  const t = useTranslations('Concierge');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom every time a new caption arrives. Cheap —
  // we only ever render last-20 messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcripts]);

  // ── State indicator copy ──────────────────────────────────────────────
  let stateText: string;
  if (state === 'error') {
    if (errorKey === 'mic_denied') stateText = t('mic_denied');
    else if (errorKey === 'quota_exceeded') stateText = t('quota_exceeded');
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

  return (
    <div
      role="dialog"
      aria-label={t('panel_title')}
      className={
        // Bottom-right anchored panel just above the FAB. Sits below the
        // toast layer (z-[90]) but above the workspace panel (z-[60]).
        'fixed bottom-24 right-5 z-[85] hidden w-[360px] flex-col border ' +
        'border-line bg-paper shadow-[0_2px_8px_rgba(0,0,0,0.04)] md:flex ' +
        '[border-radius:14px]'
      }
      style={{ height: 520 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[13px] font-medium text-ink">{t('panel_title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

      {/* Captions */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {transcripts.length === 0 ? (
          <p className="text-[12.5px] text-mute-soft">
            {state === 'live' ? t('state_listening') : t('state_idle')}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {transcripts.map((tr) => (
              <li key={tr.id} className="text-[13px] leading-[1.45]">
                <span className="mr-1.5 text-[11.5px] uppercase tracking-[0.08em] text-mute-soft">
                  {tr.role === 'user' ? youLabel : mochiLabel}
                </span>
                <span className="text-ink-2">{tr.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer — mute toggle. Only meaningful when transport supports it. */}
      {state === 'live' && muted !== null && (
        <div className="flex items-center justify-end border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onClick={onToggleMute}
            className="text-[11.5px] uppercase tracking-[0.08em] text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            {muted ? 'unmute' : 'mute'}
          </button>
        </div>
      )}
    </div>
  );
}
