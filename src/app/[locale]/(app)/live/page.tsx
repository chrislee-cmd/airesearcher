import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requirePreviewAccess } from '@/lib/preview-gate';
import { FeaturePage } from '@/components/ui/feature-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('translate', locale);
  const t = await getTranslations('Features');
  const tShared = await getTranslations('TranslateConsole');

  return (
    <FeaturePage
      title={t('translate.title')}
      headerRight={t('translate.cost')}
      subtitle={t('translate.description')}
    >
      <div className="rounded-[4px] border border-line-soft bg-paper px-5 py-8 text-[12.5px] leading-[1.75] text-mute">
        {tShared('foundationPlaceholder')}
      </div>
    </FeaturePage>
  );
}
