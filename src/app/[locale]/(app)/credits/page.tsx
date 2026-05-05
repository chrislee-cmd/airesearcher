import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getOrgCredits } from '@/lib/credits';
import { FEATURES, FEATURE_GROUPS } from '@/lib/features';
import { CreditsBundles } from '@/components/credits-bundles';

const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f] as const));

export default async function CreditsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Credits');
  const tSidebar = await getTranslations('Sidebar');
  const tFeatures = await getTranslations('Features');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

      <section className="mt-12">
        <h2 className="border-b border-line pb-2 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('schemeTitle')}
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_GROUPS.flatMap((g) =>
            g.features.map((key) => {
              if (!FEATURE_BY_KEY.has(key)) return null;
              return (
                <div
                  key={key}
                  className="flex items-baseline justify-between border-b border-line-soft py-1.5"
                >
                  <span className="text-[12.5px] text-mute">
                    {tSidebar(key)}
                  </span>
                  <span className="text-[12.5px] text-ink-2">
                    {tFeatures(`${key}.cost`)}
                  </span>
                </div>
              );
            }),
          )}
        </div>
        <p className="mt-4 max-w-[820px] text-[11.5px] leading-[1.7] text-mute-soft">
          {t('schemeNote')}
        </p>
      </section>
    </div>
  );
}
