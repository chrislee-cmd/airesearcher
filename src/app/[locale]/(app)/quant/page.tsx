import { setRequestLocale, getTranslations } from 'next-intl/server';
import { QuantAnalyzer } from '@/components/quant-analyzer';
import { FeaturePage } from '@/components/ui/feature-page';
import { requirePreviewAccess } from '@/lib/preview-gate';

export default async function QuantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('quant', locale);
  const t = await getTranslations('Features');

  return (
    <FeaturePage
      title={t('quant.title')}
      headerRight={t('quant.cost')}
    >
      <QuantAnalyzer />
    </FeaturePage>
  );
}
