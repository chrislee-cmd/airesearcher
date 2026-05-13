'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';

const inputCls =
  'mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink-2 focus:border-amore focus:outline-none [border-radius:4px]';
const labelCls =
  'text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft';

export function ForgotPasswordForm() {
  const t = useTranslations('Auth');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    track('auth_forgot_password_click');
    startTransition(async () => {
      const supabase = createClient();
      // Send the user back through /auth/callback so the recovery token is
      // exchanged for a session; the callback redirects to /reset-password
      // (handled via the `next` query param).
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        '/reset-password',
      )}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) {
        setError(t(mapAuthError(error.message, 'reset')));
        return;
      }
      track('auth_forgot_password_sent');
      setInfo(t('resetLinkSent'));
    });
  }

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

      {error && <p className="text-[11.5px] text-warning">{error}</p>}
      {info && <p className="text-[11.5px] text-mute">{info}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-ink bg-ink px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:opacity-60 [border-radius:4px]"
      >
        {pending ? '…' : t('sendResetLink')}
      </button>
    </form>
  );
}
