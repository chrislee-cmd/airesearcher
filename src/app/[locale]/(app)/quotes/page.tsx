import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TranscriptStudio } from '@/components/transcript-studio';
import { CoachmarkTour } from '@/components/coachmark-tour';
import { FeaturePage } from '@/components/ui/feature-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('quotes.title')}
      headerRight={t('quotes.cost')}
    >
      <CoachmarkTour feature="quotes" />
      <TranscriptStudio />
    </FeaturePage>
  );
}
