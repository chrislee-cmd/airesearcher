import { setRequestLocale } from 'next-intl/server';
import { FeaturePlaceholder } from '@/components/feature-placeholder';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FeaturePlaceholder feature="transcripts" />;
}
