import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ForgotPasswordForm } from '@/components/forgot-password-form';

export default async function ForgotPasswordPage({
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
      <div className="w-full max-w-[420px] border border-line bg-paper p-9 [border-radius:4px]">
        <h1 className="text-[20px] font-bold tracking-[-0.018em] text-ink-2">
          {t('forgotPasswordTitle')}
        </h1>
        <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
          {t('forgotPasswordSubtitle')}
        </p>
        <div className="mt-7">
          <ForgotPasswordForm />
        </div>
        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2"
          >
            {t('backToSignIn')}
          </Link>
        </div>
      </div>
    </main>
  );
}
