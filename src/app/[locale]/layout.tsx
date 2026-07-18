import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { MixpanelProvider } from '@/components/mixpanel-provider';
import { PostHogProvider } from '@/components/analytics/posthog-provider';
import { AuthProvider } from '@/components/auth-provider';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { DesignAuditToggle } from '@/components/design-audit-toggle';
import { LocaleSuggestBanner } from '@/components/locale-suggest-banner';
import { createClient } from '@/lib/supabase/server';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Research-Canvas',
  description: 'AI tools for marketing & UX research',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Resolve the QA-tester flag server-side so QA-only UI renders correctly on
  // first paint (no flash for real QA testers). Refreshed client-side on login.
  let isQaTester = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_qa_tester')
      .eq('id', user.id)
      .maybeSingle();
    isQaTester = profile?.is_qa_tester ?? false;
  }

  return (
    <html lang={locale} className="h-full" data-theme="pop">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="h-full flex flex-col bg-paper text-ink">
        <NextIntlClientProvider>
          <MixpanelProvider>
            <PostHogProvider>
              <AuthProvider initialUser={user} initialIsQaTester={isQaTester}>
                {children}
              </AuthProvider>
              {/* 영어 디폴트 진입 이탈 완충 — 한국어/일본어/태국어 브라우저
                  첫 방문에 1회성 언어 제안 배너(client-only, /en 에서만). */}
              <LocaleSuggestBanner />
              <CookieConsentBanner />
              {/* 디자인 감사 테마 토글 — dev QA 전용. 프로덕션 빌드에선
                  false && … 로 dead-code 라 유저 비노출(§audit sentinel). */}
              {process.env.NODE_ENV !== 'production' && <DesignAuditToggle />}
            </PostHogProvider>
          </MixpanelProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
