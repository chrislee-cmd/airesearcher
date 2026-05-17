import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requirePreviewAccess } from '@/lib/preview-gate';
import { FeaturePage } from '@/components/ui/feature-page';
import { VideoAnalyzer } from '@/components/video-analyzer';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('video', locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('video.title')}
      headerRight={t('video.cost')}
    >
      <VideoAnalyzer />
    </FeaturePage>
  );
}
