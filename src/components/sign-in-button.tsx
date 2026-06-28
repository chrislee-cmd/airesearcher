'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';

export function SignInButton() {
  const { openLogin } = useAuth();
  const t = useTranslations('Auth');
  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={() => openLogin()}
      className="!px-3 !text-sm uppercase tracking-[0.18em]"
    >
      {t('signIn')}
    </Button>
  );
}
