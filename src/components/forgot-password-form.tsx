'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <Input
        label={t('email')}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      {error && <p className="text-[11.5px] text-warning">{error}</p>}
      {info && <p className="text-[11.5px] text-mute">{info}</p>}

      <Button
        type="submit"
        variant="primary"
        size="cta"
        fullWidth
        disabled={pending}
      >
        {pending ? '…' : t('sendResetLink')}
      </Button>
    </form>
  );
}
