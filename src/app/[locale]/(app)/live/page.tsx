import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requirePreviewAccess } from '@/lib/preview-gate';
import { FeaturePage } from '@/components/ui/feature-page';
import { TranslateConsole } from '@/components/translate-console';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('translate', locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('translate.title')}
      headerRight={t('translate.cost')}
      subtitle={t('translate.description')}
    >
      <TranslateConsole />
    </FeaturePage>
  );
}
