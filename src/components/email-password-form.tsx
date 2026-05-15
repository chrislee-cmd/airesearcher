'use client';

import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';

// Only allow same-origin app paths to prevent open-redirect via ?next=.
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

const inputCls =
  'mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink-2 focus:border-amore focus:outline-none [border-radius:14px]';
const labelCls =
  'text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft';
const linkCls =
  'text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2';

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
        <div>
          <label className={labelCls}>{t('fullName')}</label>
          <input
            type="text"
            autoComplete="name"
            value={fullName}
            placeholder={t('fullNamePlaceholder')}
            onChange={(e) => setFullName(e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      <div>
        <label className={labelCls}>{t('email')}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className={labelCls}>{t('password')}</label>
          {mode === 'signIn' && (
            <Link href="/forgot-password" className={linkCls}>
              {t('forgotPassword')}
            </Link>
          )}
          {mode === 'signUp' && (
            <span className="text-[10.5px] text-mute-soft">
              {t('passwordHint')}
            </span>
          )}
        </div>
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>

      {mode === 'signUp' && (
        <div>
          <label className={labelCls}>{t('passwordConfirm')}</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      {error && <p className="text-[11.5px] text-warning">{error}</p>}
      {info && (
        <div className="space-y-1.5">
          <p className="text-[11.5px] text-mute">{info}</p>
          {pendingEmail && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-mute-soft">{t('didntGetEmail')}</span>
              <button
                type="button"
                onClick={onResend}
                disabled={pending}
                className="text-amore underline-offset-2 transition-colors duration-[120ms] hover:underline disabled:opacity-60"
              >
                {t('resendEmail')}
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full border border-ink bg-ink px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-all duration-[120ms] hover:-translate-y-px hover:bg-ink-2 hover:shadow-[0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)] disabled:opacity-60"
      >
        {pending ? '…' : t(mode)}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          clearStatus();
          setPendingEmail(null);
        }}
        className="block w-full text-center text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2"
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </button>
    </form>
  );
}
