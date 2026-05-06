import { setRequestLocale } from 'next-intl/server';
import { ComingSoonCard } from '@/components/coming-soon-card';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ComingSoonCard feature="analyzer" />;
}
