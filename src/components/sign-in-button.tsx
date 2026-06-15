'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';

export function SignInButton() {
  const { openLogin } = useAuth();
  const t = useTranslations('Auth');
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={() => openLogin()}
      className="!px-3 !text-[11px] uppercase tracking-[0.18em]"
    >
      {t('signIn')}
    </Button>
  );
}
