import { setRequestLocale } from 'next-intl/server';
import { ComingSoonCard } from '@/components/coming-soon-card';
import { requirePreviewAccess } from '@/lib/preview-gate';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('survey', locale);
  return <ComingSoonCard feature="survey" />;
}
