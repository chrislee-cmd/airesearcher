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
  title: 'Intellicenter',
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
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink-2">
        <NextIntlClientProvider>
          <MixpanelProvider>
            <AuthProvider initialUser={user}>{children}</AuthProvider>
          </MixpanelProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
