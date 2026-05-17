import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { MixpanelProvider } from '@/components/mixpanel-provider';
import { AuthProvider } from '@/components/auth-provider';
import { createClient } from '@/lib/supabase/server';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Research-mochi',
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

  return (
    <html lang={locale} className="h-full">
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
            <AuthProvider initialUser={user}>{children}</AuthProvider>
          </MixpanelProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
