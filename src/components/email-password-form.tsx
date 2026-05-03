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
        const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
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

  const inputCls =
    'mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink-2 focus:border-amore focus:outline-none [border-radius:4px]';
  const labelCls =
    'text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft';

  return (
    <form onSubmit={submit} className="space-y-4">
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
        <label className={labelCls}>{t('password')}</label>
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

      {error && <p className="text-[11.5px] text-warning">{error}</p>}
      {info && <p className="text-[11.5px] text-mute">{info}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-ink bg-ink px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:opacity-60 [border-radius:4px]"
      >
        {pending ? '…' : t(mode)}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          setError(null);
          setInfo(null);
        }}
        className="block w-full text-center text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2"
      >
        {mode === 'signIn' ? t('switchToSignUp') : t('switchToSignIn')}
      </button>
    </form>
  );
}
