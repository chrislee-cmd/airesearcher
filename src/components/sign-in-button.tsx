'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from './auth-provider';

export function SignInButton() {
  const { openLogin } = useAuth();
  const t = useTranslations('Auth');
  return (
    <button
      onClick={() => openLogin()}
      className="border border-ink bg-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:14px]"
    >
      {t('signIn')}
    </button>
  );
}
