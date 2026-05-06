import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TranscriptStudio } from '@/components/transcript-studio';
import { CoachmarkTour } from '@/components/coachmark-tour';

export default async function Page({
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
          {t('quotes.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('quotes.cost')}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('quotes.description')}
      </p>

      <div className="mt-8">
        <CoachmarkTour feature="quotes" />
        <TranscriptStudio />
      </div>
    </div>
  );
}
