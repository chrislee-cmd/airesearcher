import { setRequestLocale, getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { getOrgCredits } from '@/lib/credits';
import { CreditsBundles } from '@/components/credits-bundles';
import { CreditsUsagePredictor } from '@/components/credits-usage-predictor';

export default async function CreditsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Credits');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;
  const credits = org ? await getOrgCredits(org.org_id) : null;

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('pageEyebrow')}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
            {t('pageTitle')}
          </h1>
          <div className="text-right">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('currentBalance')}
            </div>
            <div className="mt-0.5 text-[20px] font-bold tabular-nums text-ink">
              {credits === null ? '—' : credits.toLocaleString()}
              <span className="ml-1 text-[11px] text-mute-soft">
                {t('creditsUnit')}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
          {t('pageSubtitle')}
        </p>
      </div>

      <CreditsBundles />

      <CreditsUsagePredictor />
    </div>
  );
}
