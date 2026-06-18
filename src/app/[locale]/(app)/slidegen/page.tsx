import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requirePreviewAccess } from '@/lib/preview-gate';
import { FeaturePage } from '@/components/ui/feature-page';
import { SlidegenConsole } from '@/components/slidegen/slidegen-console';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('slidegen', locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('slidegen.title')}
      headerRight={t('slidegen.cost')}
      subtitle={t('slidegen.description')}
    >
      <SlidegenConsole />
    </FeaturePage>
  );
}
