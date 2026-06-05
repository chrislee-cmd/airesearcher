import { setRequestLocale } from 'next-intl/server';
import { FeaturePlaceholder } from '@/components/feature-placeholder';

export default async function InsightsAnalyzerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FeaturePlaceholder feature="insights_analyzer" />;
}
