'use client';

import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { track } from '@/components/mixpanel-provider';
import {
  CONSENT_VERSION,
  OAUTH_CONSENT_COOKIE,
  OAUTH_CONSENT_COOKIE_MAX_AGE_S,
} from '@/lib/consent';
import { Button } from './ui/button';

// Only allow same-origin app paths to prevent open-redirect via ?next=.
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

// Stamps a short-lived consent cookie so /auth/callback can record the
// signup consents once the OAuth round-trip lands. Set just before the
// redirect — the cookie has to exist before the user leaves the page,
// since the callback runs on the redirect back.
function setOauthConsentCookie(payload: {
  privacy: true;
  terms: true;
  marketing: boolean;
}) {
  const value = encodeURIComponent(
    JSON.stringify({ version: CONSENT_VERSION, ...payload }),
  );
  // Lax + secure (when https). path=/ so callback (under /auth) can read.
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? '; Secure'
    : '';
  document.cookie =
    `${OAUTH_CONSENT_COOKIE}=${value}; Max-Age=${OAUTH_CONSENT_COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

export function GoogleSignInButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false);
  const locale = useLocale();
  const searchParams = useSearchParams();

  async function signIn() {
    track('auth_google_signin_click');
    setLoading(true);
    // Google OAuth doubles as signup for new users — stamp consents
    // before the redirect so the callback can persist them with a real
    // user_id. For existing users, /auth/callback skips the insert when
    // a current-version row already exists.
    setOauthConsentCookie({ privacy: true, terms: true, marketing: false });
    const supabase = createClient();
    const origin = window.location.origin;
    const nextPath = safeNext(searchParams.get('next')) ?? '/canvas';
    const next = `/${locale}${nextPath}`;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }

  return (
    <Button
      variant="ghost"
      size="md"
      fullWidth
      onClick={signIn}
      disabled={loading}
      className="!gap-3 !px-4 !py-2.5 !text-md !font-medium !text-ink-2 hover:!bg-paper-soft disabled:!opacity-60"
    >
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
        <path fill="#1F5795" d="M12 11.4v3.3h4.7c-.2 1.2-1.5 3.5-4.7 3.5-2.8 0-5.1-2.3-5.1-5.2s2.3-5.2 5.1-5.2c1.6 0 2.7.7 3.3 1.3l2.3-2.2C16.1 5.5 14.3 4.6 12 4.6 7.9 4.6 4.6 7.9 4.6 12s3.3 7.4 7.4 7.4c4.3 0 7.1-3 7.1-7.2 0-.5 0-.8-.1-1.2H12z" />
      </svg>
      {loading ? '…' : label}
    </Button>
  );
}
