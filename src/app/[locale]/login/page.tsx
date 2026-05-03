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
      <div className="w-full max-w-[420px] border border-line bg-paper p-9 [border-radius:4px]">
        <div className="flex items-center gap-2.5">
          <span className="accent-line" />
          <span className="eyebrow">Sign in</span>
        </div>
        <h1 className="mt-3 text-[20px] font-bold tracking-[-0.018em] text-ink-2">
          {t('signInTitle')}
        </h1>
        <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
          {t('signInSubtitle')}
        </p>
        <div className="mt-7">
          <GoogleSignInButton label={t('google')} />
        </div>
        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('or')}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <EmailPasswordForm />
      </div>
    </main>
  );
}
