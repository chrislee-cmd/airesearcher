'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  FEATURE_COSTS,
  type CreditBundleId,
  type FeatureKey,
} from '@/lib/features';

const BUNDLE_LABEL_KEY: Record<CreditBundleId, string> = {
  starter: 'bundleStarter',
  team: 'bundleTeam',
  studio: 'bundleStudio',
  enterprise: 'bundleEnterprise',
};

// Curated list shown in the simulator — the chargeable headline features only.
// Sorted by descending per-use cost so the heaviest line items come first and
// the trade-off ("one report ≈ five interviews") reads top-down.
const PREDICTOR_FEATURE_KEYS: FeatureKey[] = [
  'reports',
  'desk',
  'quotes',
  'quant',
  'recruiting',
  'interviews',
];
const PREDICTOR_FEATURES = PREDICTOR_FEATURE_KEYS.map((key) => ({
  key,
  cost: FEATURE_COSTS[key],
})).sort((a, b) => b.cost - a.cost);

// "Enterprise" is contact-sales (priceKrw=null) and bundle-size 5,000 dwarfs the
// rest of the UI; restrict the predictor to bundles with a real price.
const PREDICTOR_BUNDLES = CREDIT_BUNDLES.filter((b) => b.priceKrw != null);

function defaultBundleId(): CreditBundleId {
  return PREDICTOR_BUNDLES.find((b) => b.popular)?.id ?? PREDICTOR_BUNDLES[0].id;
}

export function CreditsUsagePredictor() {
  const t = useTranslations('Credits');
  const tSidebar = useTranslations('Sidebar');

  const [bundleId, setBundleId] = useState<CreditBundleId>(defaultBundleId);
  const bundle = PREDICTOR_BUNDLES.find((b) => b.id === bundleId)!;
  const budget = bundle.credits;

  const [counts, setCounts] = useState<Record<FeatureKey, number>>(
    () => initialCounts(budget),
  );

  // When user switches bundle, rescale proportionally so the picture stays
  // sensible instead of clamping everything to zero.
  function changeBundle(id: CreditBundleId) {
    const next = PREDICTOR_BUNDLES.find((b) => b.id === id)!;
    setBundleId(id);
    setCounts((prev) => rescale(prev, next.credits));
  }

  const totalSpent = useMemo(
    () =>
      PREDICTOR_FEATURES.reduce(
        (sum, f) => sum + (counts[f.key] ?? 0) * f.cost,
        0,
      ),
    [counts],
  );
  const remaining = Math.max(0, budget - totalSpent);
  const pctSpent = budget === 0 ? 0 : Math.min(100, (totalSpent / budget) * 100);
  const overBudget = totalSpent > budget;

  function setCount(key: FeatureKey, raw: number) {
    setCounts((prev) => {
      const cost = PREDICTOR_FEATURES.find((f) => f.key === key)!.cost;
      const others = PREDICTOR_FEATURES.reduce(
        (sum, f) => (f.key === key ? sum : sum + (prev[f.key] ?? 0) * f.cost),
        0,
      );
      const maxForThis = Math.floor(Math.max(0, budget - others) / cost);
      const clamped = Math.max(0, Math.min(maxForThis, Math.round(raw)));
      return { ...prev, [key]: clamped };
    });
  }

  function reset(mode: 'zero' | 'even') {
    if (mode === 'zero') {
      setCounts(zeroCounts());
    } else {
      setCounts(initialCounts(budget));
    }
  }

  return (
    <section className="mt-12 max-w-[560px]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
            {t('predictorTitle')}
          </h2>
          <p className="mt-1 max-w-[680px] text-[11.5px] leading-[1.7] text-mute-soft">
            {t('predictorSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => reset('even')}
            className="border border-line bg-paper px-3 py-1 text-[11px] text-mute hover:border-ink hover:text-ink-2 [border-radius:14px]"
          >
            {t('predictorResetEven')}
          </button>
          <button
            type="button"
            onClick={() => reset('zero')}
            className="border border-line bg-paper px-3 py-1 text-[11px] text-mute hover:border-ink hover:text-ink-2 [border-radius:14px]"
          >
            {t('predictorResetZero')}
          </button>
        </div>
      </div>

      {/* Bundle selector */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PREDICTOR_BUNDLES.map((b) => {
          const active = b.id === bundleId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => changeBundle(b.id)}
              className={
                'flex flex-col items-start gap-0.5 border px-3 py-2 text-left [border-radius:14px] ' +
                (active
                  ? 'border-ink bg-paper text-ink-2'
                  : 'border-line bg-paper text-mute hover:border-ink-2 hover:text-ink-2')
              }
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {t(BUNDLE_LABEL_KEY[b.id])}
              </span>
              <span className="text-[14px] font-semibold tabular-nums text-ink">
                {b.credits.toLocaleString()}{' '}
                <span className="text-[10.5px] font-normal text-mute-soft">
                  {t('creditsUnit')}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Budget bar */}
      <div className="mt-5 border border-line bg-paper p-4 [border-radius:14px]">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('predictorBudgetLabel')}
          </div>
          <div className="text-[12.5px] tabular-nums text-mute">
            <span className={overBudget ? 'text-warning font-semibold' : 'text-ink-2 font-semibold'}>
              {totalSpent.toLocaleString()}
            </span>
            <span className="mx-1 text-mute-soft">/</span>
            <span>{budget.toLocaleString()}</span>{' '}
            <span className="text-[10.5px] text-mute-soft">{t('creditsUnit')}</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden bg-line-soft [border-radius:2px]">
          <div
            className={'h-full transition-[width] duration-150 ' + (overBudget ? 'bg-warning' : 'bg-amore')}
            style={{ width: `${pctSpent}%` }}
          />
        </div>
        <div className="mt-2 text-[10.5px] tabular-nums text-mute-soft">
          {t('predictorRemaining', { count: remaining.toLocaleString() })}
        </div>
      </div>

      {/* Per-feature sliders */}
      <div className="mt-5 flex flex-col">
        {PREDICTOR_FEATURES.map((f) => {
          const count = counts[f.key] ?? 0;
          const others = totalSpent - count * f.cost;
          const maxForThis = Math.floor(Math.max(0, budget - others) / f.cost);
          // Slider absolute max = total budget at this cost (so the track length
          // is stable across features); the "soft" cap maxForThis is enforced
          // in setCount when the value lands.
          const absMax = Math.max(1, Math.floor(budget / f.cost));
          const spentHere = count * f.cost;
          return (
            <div key={f.key} className="border-b border-line-soft py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] text-ink-2">{tSidebar(f.key)}</span>
                <span className="text-[11px] tabular-nums text-mute-soft">
                  {t('predictorPerUse', { cost: f.cost })}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={absMax}
                  step={1}
                  value={count}
                  onChange={(e) => setCount(f.key, Number(e.target.value))}
                  className="h-1 flex-1 cursor-pointer appearance-none bg-line-soft accent-amore [border-radius:2px]"
                  aria-label={tSidebar(f.key)}
                />
                <div className="min-w-[110px] text-right text-[12px] tabular-nums">
                  <span className="font-semibold text-ink">
                    {t('predictorUses', { count })}
                  </span>
                  <span className="ml-1 text-[10.5px] text-mute-soft">
                    ({spentHere.toLocaleString()} {t('creditsUnit')})
                  </span>
                </div>
              </div>
              {count >= maxForThis && maxForThis < absMax && !overBudget && (
                <div className="mt-1 text-[10px] text-mute-soft">
                  {t('predictorAtCap')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 max-w-[820px] text-[11px] leading-[1.7] text-mute-soft">
        {t('schemeNote')}
      </p>
    </section>
  );
}

function zeroCounts(): Record<FeatureKey, number> {
  const out = {} as Record<FeatureKey, number>;
  for (const f of PREDICTOR_FEATURES) out[f.key] = 0;
  return out;
}

// Default mix: spread the budget evenly across chargeable features so the bar
// starts ~70-90% full and the user immediately sees the trade-off.
function initialCounts(budget: number): Record<FeatureKey, number> {
  const n = PREDICTOR_FEATURES.length;
  const perFeatureBudget = Math.floor(budget / n);
  const out = {} as Record<FeatureKey, number>;
  for (const f of PREDICTOR_FEATURES) {
    out[f.key] = Math.max(0, Math.floor(perFeatureBudget / f.cost));
  }
  return out;
}

function rescale(
  prev: Record<FeatureKey, number>,
  newBudget: number,
): Record<FeatureKey, number> {
  const prevSpent = PREDICTOR_FEATURES.reduce(
    (sum, f) => sum + (prev[f.key] ?? 0) * f.cost,
    0,
  );
  if (prevSpent === 0) return initialCounts(newBudget);
  const factor = newBudget / prevSpent;
  const out = {} as Record<FeatureKey, number>;
  for (const f of PREDICTOR_FEATURES) {
    out[f.key] = Math.max(0, Math.floor((prev[f.key] ?? 0) * factor));
  }
  return out;
}
