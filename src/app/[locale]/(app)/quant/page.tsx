import { setRequestLocale, getTranslations } from 'next-intl/server';
import { QuantAnalyzer } from '@/components/quant-analyzer';
import { CoachmarkTour } from '@/components/coachmark-tour';

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

      <div className="mt-8">
        <CoachmarkTour feature="quant" />
        <QuantAnalyzer />
      </div>
    </div>
  );
}
