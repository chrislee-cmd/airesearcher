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
      leftIcon={<GoogleLogo />}
      // Google 공식 OAuth 가이드는 subtle — LoginDialog 카드 (3px border + 6px
      // shadow) 안에서 ghost 의 Memphis 톤 (2.5px border + offset shadow + hover
      // translate) 이 이중 강조로 충돌. border-line 유지 + shadow/translate 제거
      // 로 subtle 하게. header-subtle PR 머지 후 subtle variant 로 자연 통합.
      className="shadow-none hover:border-line hover:translate-x-0 hover:translate-y-0 hover:shadow-none hover:bg-paper-soft"
    >
      {loading ? '…' : label}
    </Button>
  );
}

function GoogleLogo() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
