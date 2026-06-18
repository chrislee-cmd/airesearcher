'use client';

import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Only allow same-origin app paths to prevent open-redirect via ?next=.
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

const linkCls =
  'text-sm text-mute transition-colors duration-[120ms] hover:text-ink-2';

export function EmailPasswordForm() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // After a signup that requires email confirmation, remember the address so
  // the user can resend the confirmation without retyping.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    track(mode === 'signIn' ? 'auth_signin_click' : 'auth_signup_click');
    startTransition(async () => {
      const supabase = createClient();
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
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
        track('auth_signin_success');
        router.replace(next);
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
          track('auth_signup_success');
          router.replace(next);
          router.refresh();
        } else {
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
        disabled={pending}
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
