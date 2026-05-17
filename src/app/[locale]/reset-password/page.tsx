import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ResetPasswordForm } from '@/components/reset-password-form';

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth');

  // Reset link → /auth/callback exchanges the recovery code for a session,
  // then redirects here. If we arrived without a session (link expired or
  // direct visit), bounce back to the request form instead of letting
  // updateUser fail with an opaque "Auth session missing" error.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: '/forgot-password', locale });
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-[420px] border border-line bg-paper p-9 [border-radius:14px]">
        <h1 className="text-[20px] font-bold tracking-[-0.018em] text-ink-2">
          {t('resetPasswordTitle')}
        </h1>
        <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
          {t('resetPasswordSubtitle')}
        </p>
        <div className="mt-7">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
