import { setRequestLocale, getTranslations } from 'next-intl/server';
import { QuantAnalyzer } from '@/components/quant-analyzer';
import { Coachmark } from '@/components/coachmark';

export default async function QuantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('quant.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('quant.cost')}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('quant.description')}
      </p>

      <div className="mt-8">
        <Coachmark feature="quant" />
        <QuantAnalyzer />
      </div>
    </div>
  );
}
