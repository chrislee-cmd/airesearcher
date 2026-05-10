import { setRequestLocale, getTranslations } from 'next-intl/server';
import { QuantAnalyzer } from '@/components/quant-analyzer';
import { CoachmarkTour } from '@/components/coachmark-tour';
import { FeaturePage } from '@/components/ui/feature-page';

export default async function QuantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('quant.title')}
      headerRight={t('quant.cost')}
    >
      <CoachmarkTour feature="quant" />
      <QuantAnalyzer />
    </FeaturePage>
  );
}
