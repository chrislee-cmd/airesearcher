import { setRequestLocale, getTranslations } from 'next-intl/server';
import { InterviewAnalyzer } from '@/components/interview-analyzer';
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
      title={t('interviews.title')}
      headerRight={t('interviews.cost')}
    >
      <InterviewAnalyzer />
    </FeaturePage>
  );
}
