'use client';

import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';
import { routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Only allow same-origin app paths to prevent open-redirect via ?next=.
function safeNext(raw: string | null): string {
  if (!raw) return '/canvas';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/canvas';
  return raw;
}

const linkCls =
  'text-sm text-mute transition-colors duration-[120ms] hover:text-ink-2';

// Fire-and-forget: a failed audit log must not block the redirect.
function reportLoginEvent(payload: {
  event_type: 'login_success' | 'login_failure';
  email?: string;
  reason?: string;
}) {
  try {
    void fetch('/api/audit/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — audit best-effort
  }
}

function persistSignupConsents(marketing: boolean) {
  try {
    void fetch('/api/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'signup_email',
        consents: [
          { type: 'privacy_policy', granted: true },
          { type: 'terms_of_service', granted: true },
          { type: 'marketing', granted: marketing },
        ],
      }),
    }).catch(() => {});
  } catch {
    // ignore — consent insert best-effort, surfaced in audit logs
  }
}

export function EmailPasswordForm() {
  const t = useTranslations('Auth');
  const tConsent = useTranslations('Consent');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // After a signup that requires email confirmation, remember the address so
  // the user can resend the confirmation without retyping.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const consentsOk = mode === 'signIn' || (agreePrivacy && agreeTerms);

  function clearStatus() {
    setError(null);
    setInfo(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    clearStatus();
    if (mode === 'signUp' && password !== passwordConfirm) {
      setError(t('passwordMismatch'));
      return;
    }
    if (mode === 'signUp' && !consentsOk) {
      setError(tConsent('errorRequired'));
      return;
    }
    track(mode === 'signIn' ? 'auth_signin_click' : 'auth_signup_click');
    startTransition(async () => {
      const supabase = createClient();
      if (mode === 'signIn') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          reportLoginEvent({
            event_type: 'login_failure',
            email,
            reason: error.message,
          });
          setError(t(mapAuthError(error.message, 'signIn')));
          return;
        }
        // Single-session enforcement: revoke other active sessions in
        // the background. Awaiting this (the previous behavior) was
        // clearing the just-set sb-* cookies in browser states that had
        // prior sessions on the same Supabase user — the user landed on
        // /dashboard authenticated to the auth state machine but with
        // no auth cookies, so every API call returned 401. This is a UX
        // feature, not a security gate (the auth server still enforces
        // the revocation when it lands), so silent best-effort is fine.
        void supabase.auth.signOut({ scope: 'others' }).catch(() => {});
        reportLoginEvent({ event_type: 'login_success' });
        track('auth_signin_success');
        // Cross-device language preference: apply the saved profiles.locale so
        // a user who explicitly picked, say, Korean on another device lands on
        // /ko here too. Mirrors the OAuth callback (auth/callback/route.ts).
        // Password login bypasses that callback, so we apply it inline. DB
        // preference wins over the current page locale; best-effort — any
        // failure just falls through to `next` under the current locale.
        let localeOpts: { locale: string } | undefined;
        const userId = data.user?.id;
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('locale')
            .eq('id', userId)
            .maybeSingle();
          const pref = profile?.locale;
          if (
            pref &&
            (routing.locales as readonly string[]).includes(pref) &&
            pref !== locale
          ) {
            localeOpts = { locale: pref };
          }
        }
        router.replace(next, localeOpts);
        router.refresh();
      } else {
        const trimmedName = fullName.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            // `full_name` is read by the handle_new_user trigger to seed the
            // profile and the user's first organization's display name. With-
            // out it, the org name falls back to the email address.
            data: trimmedName ? { full_name: trimmedName } : undefined,
          },
        });
        if (error) {
          setError(t(mapAuthError(error.message, 'signUp')));
          return;
        }
        if (data.session) {
          // Session lands immediately (confirmations disabled or already
          // confirmed) — record consents now while the cookie is fresh.
          persistSignupConsents(agreeMarketing);
          track('auth_signup_success');
          router.replace(next);
          router.refresh();
        } else {
          // Pending email confirmation — defer consent insert to
          // /auth/callback once exchangeCodeForSession lands the cookie.
          track('auth_signup_email_pending');
          setPendingEmail(email);
          setInfo(t('checkEmail'));
        }
      }
    });
  }

  function onResend() {
    if (!pendingEmail) return;
    clearStatus();
    track('auth_signup_resend_click');
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(t(mapAuthError(error.message, 'signUp')));
        return;
      }
      track('auth_signup_resend_sent');
      setInfo(t('resendEmailSent'));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === 'signUp' && (
        <Input
          label={t('fullName')}
          type="text"
          autoComplete="name"
          value={fullName}
          placeholder={t('fullNamePlaceholder')}
          onChange={(e) => setFullName(e.target.value)}
        />
      )}

      <Input
        label={t('email')}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <Label htmlFor="password" className="mb-0">
            {t('password')}
          </Label>
          {mode === 'signIn' && (
            <Link href="/forgot-password" className={linkCls}>
              {t('forgotPassword')}
            </Link>
          )}
          {mode === 'signUp' && (
            <span className="text-xs-soft text-mute-soft">
              {t('passwordHint')}
            </span>
          )}
        </div>
        <Input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {mode === 'signUp' && (
        <Input
          label={t('passwordConfirm')}
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
        />
      )}

      {mode === 'signUp' && (
        <ConsentChecklist
          locale={locale}
          agreePrivacy={agreePrivacy}
          setAgreePrivacy={setAgreePrivacy}
          agreeTerms={agreeTerms}
          setAgreeTerms={setAgreeTerms}
          agreeMarketing={agreeMarketing}
          setAgreeMarketing={setAgreeMarketing}
        />
      )}

      {error && <p className="text-sm text-warning">{error}</p>}
      {info && (
        <div className="space-y-1.5">
          <p className="text-sm text-mute">{info}</p>
          {pendingEmail && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-mute-soft">{t('didntGetEmail')}</span>
              <Button
                variant="link"
                size="xs"
                onClick={onResend}
                disabled={pending}
                className="text-amore underline-offset-2 hover:underline hover:text-amore"
              >
                {t('resendEmail')}
              </Button>
            </div>
          )}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="cta"
        fullWidth
        disabled={pending || (mode === 'signUp' && !consentsOk)}
      >
        {pending ? '…' : t(mode)}
      </Button>

      <Button
        variant="link"
        size="sm"
        fullWidth
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          clearStatus();
          setPendingEmail(null);
        }}
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </Button>
    </form>
  );
}

function ConsentChecklist({
  locale,
  agreePrivacy,
  setAgreePrivacy,
  agreeTerms,
  setAgreeTerms,
  agreeMarketing,
  setAgreeMarketing,
}: {
  locale: string;
  agreePrivacy: boolean;
  setAgreePrivacy: (v: boolean) => void;
  agreeTerms: boolean;
  setAgreeTerms: (v: boolean) => void;
  agreeMarketing: boolean;
  setAgreeMarketing: (v: boolean) => void;
}) {
  const tConsent = useTranslations('Consent');
  const allRequired = agreePrivacy && agreeTerms;
  const allToggle = (next: boolean) => {
    setAgreePrivacy(next);
    setAgreeTerms(next);
    setAgreeMarketing(next);
  };

  return (
    <fieldset className="space-y-2 border-t border-line-soft pt-4">
      <legend className="sr-only">{tConsent('legend')}</legend>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <Checkbox
          checked={allRequired && agreeMarketing}
          onChange={(e) => allToggle(e.target.checked)}
          aria-label={tConsent('agreeAll')}
        />
        <span className="font-semibold">{tConsent('agreeAll')}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-mute">
        <Checkbox
          checked={agreePrivacy}
          onChange={(e) => setAgreePrivacy(e.target.checked)}
          className="mt-[3px]"
          aria-label={tConsent('privacy')}
        />
        <span>
          <span className="text-warning">*</span>{' '}
          <a
            href={`/${locale}/privacy`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-2 underline-offset-2 hover:underline"
          >
            {tConsent('privacy')}
          </a>{' '}
          <span className="text-mute-soft">{tConsent('required')}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-mute">
        <Checkbox
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="mt-[3px]"
          aria-label={tConsent('terms')}
        />
        <span>
          <span className="text-warning">*</span>{' '}
          <a
            href={`/${locale}/terms`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-2 underline-offset-2 hover:underline"
          >
            {tConsent('terms')}
          </a>{' '}
          <span className="text-mute-soft">{tConsent('required')}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-mute">
        <Checkbox
          checked={agreeMarketing}
          onChange={(e) => setAgreeMarketing(e.target.checked)}
          className="mt-[3px]"
          aria-label={tConsent('marketing')}
        />
        <span>
          {tConsent('marketing')}{' '}
          <span className="text-mute-soft">{tConsent('optional')}</span>
        </span>
      </label>
    </fieldset>
  );
}
