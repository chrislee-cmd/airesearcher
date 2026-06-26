'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CONSENT_VERSION,
  COOKIE_CONSENT_STORAGE_KEY,
} from '@/lib/consent';

// CookieConsentBanner — mounted in the locale-layout, shown once per
// browser. The user picks essential/analytics/marketing and the choice
// is stored in localStorage (so subsequent loads skip the banner) and
// — if the user is authenticated — synced to user_consents server-side
// via /api/consent.
//
// We deliberately do NOT block render or interaction. The banner is
// fixed-bottom and dismissible by accepting/rejecting; analytics
// libraries (Mixpanel) read the stored decision before sending events
// in a follow-up PR (SEC8). For this PR the banner only persists
// preferences — it doesn't gate any tracker today.

type Choice = {
  essential: true; // always on, non-negotiable
  analytics: boolean;
  marketing: boolean;
  version: string;
  decided_at: string;
};

function readStored(): Choice | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Choice;
    if (parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistStored(choice: Choice) {
  try {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify(choice),
    );
  } catch {
    // Private mode / quota — fall through; user will see banner again.
  }
}

function syncToServer(choice: Choice) {
  try {
    void fetch('/api/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'cookie_banner',
        consents: [
          {
            type: 'analytics',
            granted: choice.analytics,
            metadata: { surface: 'banner' },
          },
          {
            type: 'marketing',
            granted: choice.marketing,
            metadata: { surface: 'banner' },
          },
        ],
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort — anonymous users will simply rely on localStorage
  }
}

export function CookieConsentBanner() {
  const t = useTranslations('CookieBanner');
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // SSR renders nothing (visible=false initial state) so the markup
    // matches across server/client. localStorage is only readable on the
    // client, so the "show banner" decision must happen post-hydration —
    // this is the legitimate "sync external state into React" case the
    // set-state-in-effect rule allows.
    if (readStored()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration external-storage probe (see comment above)
    setVisible(true);
  }, []);

  if (!visible) return null;

  function decide(next: Choice) {
    persistStored(next);
    syncToServer(next);
    setVisible(false);
  }

  function onAcceptAll() {
    decide({
      essential: true,
      analytics: true,
      marketing: true,
      version: CONSENT_VERSION,
      decided_at: new Date().toISOString(),
    });
  }

  function onRejectAll() {
    decide({
      essential: true,
      analytics: false,
      marketing: false,
      version: CONSENT_VERSION,
      decided_at: new Date().toISOString(),
    });
  }

  function onSavePreferences() {
    decide({
      essential: true,
      analytics,
      marketing,
      version: CONSENT_VERSION,
      decided_at: new Date().toISOString(),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-toast px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto w-full max-w-[640px] border border-line bg-paper p-5 rounded-md [box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.08)]">
        <h2
          id="cookie-consent-title"
          className="text-md font-semibold text-ink-2"
        >
          {t('title')}
        </h2>
        <p className="mt-1.5 text-sm leading-[1.7] text-mute">
          {t('body')}{' '}
          <a
            href={`/${locale}/privacy`}
            className="text-amore underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('learnMore')}
          </a>
        </p>

        {showDetails && (
          <fieldset className="mt-4 space-y-2 border-t border-line-soft pt-4">
            <legend className="sr-only">{t('preferencesLegend')}</legend>
            <label className="flex items-start gap-2 text-sm text-mute">
              <Checkbox
                checked
                disabled
                className="mt-[3px]"
                aria-label={t('essential')}
              />
              <span>
                <span className="font-semibold text-ink-2">
                  {t('essential')}
                </span>{' '}
                <span className="text-mute-soft">{t('alwaysOn')}</span>
                <br />
                <span className="text-xs-soft text-mute-soft">
                  {t('essentialDescription')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-mute">
              <Checkbox
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-[3px]"
                aria-label={t('analytics')}
              />
              <span>
                <span className="font-semibold text-ink-2">
                  {t('analytics')}
                </span>
                <br />
                <span className="text-xs-soft text-mute-soft">
                  {t('analyticsDescription')}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-mute">
              <Checkbox
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-[3px]"
                aria-label={t('marketing')}
              />
              <span>
                <span className="font-semibold text-ink-2">
                  {t('marketing')}
                </span>
                <br />
                <span className="text-xs-soft text-mute-soft">
                  {t('marketingDescription')}
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {!showDetails ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowDetails(true)}
            >
              {t('customize')}
            </Button>
          ) : (
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowDetails(false)}
            >
              {t('hideDetails')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRejectAll}>
            {t('rejectAll')}
          </Button>
          {showDetails ? (
            <Button variant="primary" size="sm" onClick={onSavePreferences}>
              {t('savePreferences')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onAcceptAll}>
              {t('acceptAll')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
