'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { track } from '@/components/mixpanel-provider';
import { mapAuthError } from '@/lib/auth/error-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <Input
        label={t('newPassword')}
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Input
        label={t('passwordConfirm')}
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
      />

      {error && <p className="text-sm text-warning">{error}</p>}
      {info && <p className="text-sm text-mute">{info}</p>}

      <Button
        type="submit"
        variant="primary"
        size="cta"
        fullWidth
        disabled={pending}
      >
        {pending ? '…' : t('updatePassword')}
      </Button>
    </form>
  );
}
