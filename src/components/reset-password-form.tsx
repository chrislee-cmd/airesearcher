'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';

const inputCls =
  'mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink-2 focus:border-amore focus:outline-none [border-radius:14px]';
const labelCls =
  'text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft';

export function ResetPasswordForm() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password !== passwordConfirm) {
      setError(t('passwordMismatch'));
      return;
    }
    track('auth_reset_password_click');
    startTransition(async () => {
      const supabase = createClient();
      // The user arrived here via the /auth/callback recovery exchange, so
      // they already have a live session. updateUser flips just the password.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(t(mapAuthError(error.message, 'reset')));
        return;
      }
      track('auth_reset_password_success');
      setInfo(t('passwordUpdated'));
      window.setTimeout(() => {
        router.replace('/dashboard');
        router.refresh();
      }, 1200);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelCls}>{t('newPassword')}</label>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
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

      {error && <p className="text-[11.5px] text-warning">{error}</p>}
      {info && <p className="text-[11.5px] text-mute">{info}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-ink bg-ink px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:opacity-60 [border-radius:14px]"
      >
        {pending ? '…' : t('updatePassword')}
      </button>
    </form>
  );
}
