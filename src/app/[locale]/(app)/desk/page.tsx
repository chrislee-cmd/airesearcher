import { setRequestLocale } from 'next-intl/server';
import { DeskResearch } from '@/components/desk-research';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DeskResearch />;
}
