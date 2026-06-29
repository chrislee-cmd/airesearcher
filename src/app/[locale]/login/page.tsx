import { Outfit } from 'next/font/google';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { EmailPasswordForm } from '@/components/email-password-form';
import { LanguageSwitcher } from '@/components/language-switcher';
import './login.css';

// Outfit display 폰트 — PR-D13 pop 톤 정렬. landing / canvas 와 동일 weight.
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth');

  return (
    <main
      className={`${outfit.variable} auth-pop relative flex flex-1 items-center justify-center px-6 py-12`}
    >
      <div className="pop-lang">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-[440px]">
        <header className="pop-hero">
          <span className="pop-eyebrow">Research-Canvas</span>
          <h1 className="pop-display">{t('signInTitle')}</h1>
          <p className="pop-subtitle">{t('signInSubtitle')}</p>
        </header>
        <div className="pop-card">
          <GoogleSignInButton label={t('google')} />
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('or')}
            </span>
            <span className="h-px flex-1" />
          </div>
          <EmailPasswordForm />
        </div>
      </div>
    </main>
  );
}
