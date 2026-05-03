import { setRequestLocale, getTranslations } from 'next-intl/server';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { EmailPasswordForm } from '@/components/email-password-form';
import { LanguageSwitcher } from '@/components/language-switcher';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth');

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-2xl font-semibold tracking-tight">{t('signInTitle')}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t('signInSubtitle')}</p>
        <div className="mt-8">
          <GoogleSignInButton label={t('google')} />
        </div>
        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          <span>{t('or')}</span>
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>
        <EmailPasswordForm />
      </div>
    </main>
  );
}
