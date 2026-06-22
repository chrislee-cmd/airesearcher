import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { LandingPage } from '@/components/landing/landing-page';

export default async function LocaleIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (user) {
    redirect({ href: '/canvas', locale });
  }
  return <LandingPage locale={locale} />;
}
