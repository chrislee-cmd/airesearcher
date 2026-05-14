'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

export function SignOutButton() {
  const router = useRouter();
  const t = useTranslations('Auth');

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/');
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="border border-line px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:text-ink-2 [border-radius:4px]"
    >
      {t('signOut')}
    </button>
  );
}
