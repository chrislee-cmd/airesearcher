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
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {t('signOut')}
    </button>
  );
}
