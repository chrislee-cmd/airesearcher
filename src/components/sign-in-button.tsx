'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from './auth-provider';

export function SignInButton() {
  const { openLogin } = useAuth();
  const t = useTranslations('Auth');
  return (
    <button
      onClick={() => openLogin()}
      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
    >
      {t('signIn')}
    </button>
  );
}
