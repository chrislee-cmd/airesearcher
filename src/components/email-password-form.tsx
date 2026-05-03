'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';

export function EmailPasswordForm() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const supabase = createClient();
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(t('invalidCredentials'));
          return;
        }
        router.replace('/dashboard');
        router.refresh();
      } else {
        const origin =
          process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${origin}/auth/callback` },
        });
        if (error) {
          setError(error.message);
          return;
        }
        if (data.session) {
          router.replace('/dashboard');
          router.refresh();
        } else {
          setInfo(t('checkEmail'));
        }
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-500">{t('email')}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">{t('password')}</label>
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {info && <p className="text-xs text-emerald-700">{info}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {pending ? '...' : t(mode)}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          setError(null);
          setInfo(null);
        }}
        className="block w-full text-center text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </button>
    </form>
  );
}
