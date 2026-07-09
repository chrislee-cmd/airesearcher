'use client';

// Echo-free onboarding — a non-invasive checklist shown on the 동시통역 host
// console while idle (before Start). It exists because the real cure for the
// acoustic echo loop is physical: the host's audible TTS gets re-picked-up by
// the mic. Software gates (cross-channel echo gate, #765) stop text re-entry
// but can't stop the physical path — so we guide the host into the proven
// echo-free setup (live A/B, 2026-07-06):
//   1. Mute audio on THIS device (now the default — outputAudible starts OFF).
//   2. Copy the share link → open it on a SEPARATE device.
//   3. Listen there with earphones.
//
// Deliberately NOT a blocking modal — it never gates Start (handoff
// constraint). Dismissable via "다시 안 보기" (localStorage); when dismissed a
// compact bar keeps the voice toggle + a re-open link so the mute state stays
// visible at idle.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import { ChromeButton } from '../ui/chrome-button';

const DISMISS_KEY = 'translate-echo-onboarding-dismissed';

type Props = {
  // Host's local monitor mute state (outputAudible). Default false = muted.
  audible: boolean;
  onToggleAudible: () => void;
  // Reuses the existing share_token infra. Null until a session is live —
  // the copy button activates then; at idle the step is educational.
  shareUrl: string | null;
  onCopyShareUrl: () => void;
  copied: boolean;
  // Reuses the ListenerPanel presence count — surfaces the "connected"
  // confirmation once a separate device joins the share link.
  listenerCount: number;
};

export function EchoOnboarding({
  audible,
  onToggleAudible,
  shareUrl,
  onCopyShareUrl,
  copied,
  listenerCount,
}: Props) {
  const t = useTranslations('TranslateConsole.onboarding');
  const [dismissed, setDismissed] = useState(false);

  // Read the dismiss flag AFTER hydration (not in a lazy initializer) so the
  // server render and first client render agree (both show the card); the
  // effect then hides it for users who dismissed. This is the SSR-safe
  // localStorage pattern, so the set-state-in-effect guard is opted out here.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage read must run post-hydration to avoid SSR/client mismatch
      if (window.localStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
    } catch {
      // private mode / storage blocked — treat as not dismissed.
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore — worst case the card re-appears next session.
    }
  };
  const restore = () => {
    setDismissed(false);
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore.
    }
  };

  // Shared voice toggle — the functional control behind step 1. Present in
  // both the full card and the dismissed compact bar so the mute state is
  // always visible/adjustable at idle.
  const voiceToggle = (
    <ChromeButton
      size="md"
      variant={audible ? 'default' : 'mute'}
      aria-pressed={!audible}
      aria-label={t('voiceAria')}
      onClick={onToggleAudible}
    >
      {audible ? t('voiceOn') : t('voiceOff')}
    </ChromeButton>
  );

  // Spec C — turning audible ON risks echo; warn inline (never block).
  const voiceWarning = audible ? (
    <p role="status" className="text-sm text-amore">
      {t('voiceWarning')}
    </p>
  ) : null;

  if (dismissed) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xs border-l-[3px] border-amore bg-amore-bg px-3 py-2">
        {voiceToggle}
        <span className="text-sm text-mute">
          {audible ? t('stateOn') : t('stateOff')}
        </span>
        <Button variant="link" size="xs" onClick={restore}>
          {t('restore')}
        </Button>
        {voiceWarning}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xs border-l-[3px] border-amore bg-amore-bg px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <span className="w-fit rounded-xs bg-amore px-2 py-[2px] text-xs font-semibold uppercase tracking-[0.18em] text-paper">
          {t('importantBadge')}
        </span>
        <h3 className="text-lg font-bold text-ink">{t('title')}</h3>
      </div>
      <ol className="flex flex-col gap-2 text-sm text-mute">
        <li className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-mute-soft" aria-hidden>
            1.
          </span>
          {voiceToggle}
          <span>{audible ? t('step1On') : t('step1Off')}</span>
        </li>
        {voiceWarning}
        <li className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-mute-soft" aria-hidden>
            2.
          </span>
          <span>{t('step2')}</span>
          <ChromeButton size="md" onClick={onCopyShareUrl} disabled={!shareUrl}>
            {copied ? t('step2Copied') : t('step2Copy')}
          </ChromeButton>
          {!shareUrl ? (
            <span className="text-mute-soft">{t('step2Pending')}</span>
          ) : null}
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-mute-soft" aria-hidden>
            3.
          </span>
          <span>{t('step3')}</span>
        </li>
        {listenerCount > 0 ? (
          <li className="text-amore">
            {t('connected', { count: listenerCount })}
          </li>
        ) : null}
      </ol>
      <div className="flex justify-end">
        <Button variant="link" size="xs" onClick={dismiss}>
          {t('dismiss')}
        </Button>
      </div>
    </section>
  );
}
