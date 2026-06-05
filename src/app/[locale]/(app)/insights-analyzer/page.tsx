import { setRequestLocale } from 'next-intl/server';
import { InsightsAnalyzer } from '@/components/insights/insights-analyzer';

export default async function InsightsAnalyzerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InsightsAnalyzer />;
}
