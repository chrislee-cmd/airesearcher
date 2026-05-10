import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ModeratorServicesCarousel } from '@/components/moderator-services-carousel';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');
  const tCommon = await getTranslations('Common');

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('moderator.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('moderator.cost')}
        </span>
      </div>

      <ModeratorServicesCarousel />

      <p className="mt-12 text-[11.5px] uppercase tracking-[0.22em] text-mute-soft">
        {tCommon('comingSoon')}
      </p>
    </div>
  );
}
