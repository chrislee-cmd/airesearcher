'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { ChromeButton } from './ui/chrome-button';

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
    <ChromeButton
      variant="mute"
      size="sm"
      uppercase
      onClick={signOut}
      className="!px-3 !text-sm tracking-[0.18em] hover:!text-ink-2"
    >
      {t('signOut')}
    </ChromeButton>
  );
}
