'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  FEATURE_COSTS,
  type CreditBundleId,
  type FeatureKey,
} from '@/lib/features';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { Slider } from '@/components/ui/slider';

// PR-D17 pop 톤: predictor section 도 Memphis 카드 + Outfit display 로 정렬.
// 로직 (budget / clamp / slider) 은 변경 없음.
const outfitStack = 'var(--font-outfit), var(--font-sans)';

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
  'probing',
  'quant',
  'recruiting',
  'interviews',
];
// Per-row display cost overrides — currently empty. (Historical: probing
// used to live at 5/10min ledger cost so the predictor overrode it to 25
// = 1-hour session. Now FEATURE_COSTS.probing = 25 directly, so no
// override needed; the slider unit already maps to 1 session.)
const PREDICTOR_COST_OVERRIDES: Partial<Record<FeatureKey, number>> = {};
const PREDICTOR_FEATURES = PREDICTOR_FEATURE_KEYS.map((key) => ({
  key,
  cost: PREDICTOR_COST_OVERRIDES[key] ?? FEATURE_COSTS[key],
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
    <section className="mt-14 max-w-[640px]">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
        <div>
          <span
            style={{
              fontFamily: outfitStack,
              background: 'var(--canvas-accent)',
              border: '2.5px solid var(--canvas-card-border)',
              boxShadow: 'var(--memphis-shadow-xs)',
              color: '#fff',
            }}
            className="inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]"
          >
            {t('predictorTitle')}
          </span>
          <p className="mt-3 max-w-[680px] text-sm leading-[1.7] text-mute">
            {t('predictorSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChromeButton variant="mute" size="sm" onClick={() => reset('even')}>
            {t('predictorResetEven')}
          </ChromeButton>
          <ChromeButton variant="mute" size="sm" onClick={() => reset('zero')}>
            {t('predictorResetZero')}
          </ChromeButton>
        </div>
      </div>

      {/* Bundle selector — Memphis cards */}
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PREDICTOR_BUNDLES.map((b) => {
          const active = b.id === bundleId;
          const layout =
            '!justify-start !items-start text-left !px-3 !py-2 !font-normal';
          return (
            <Button
              key={b.id}
              variant="ghost"
              size="sm"
              onClick={() => changeBundle(b.id)}
              style={{
                background: active ? '#fff0f4' : '#fff',
                color: '#000',
                border: `${active ? 3 : 2.5}px solid var(--canvas-card-border)`,
                borderRadius: '10px',
                boxShadow: active ? '4px 4px 0 var(--canvas-card-border)' : '2px 2px 0 var(--canvas-card-border)',
                fontFamily: outfitStack,
                fontWeight: 700,
                opacity: 1,
              }}
              className={layout}
            >
              <span className="flex flex-col items-start gap-0.5 w-full">
                <span
                  style={{ fontFamily: outfitStack }}
                  className="text-xs-soft font-extrabold uppercase tracking-[0.22em] text-ink-2"
                >
                  {t(BUNDLE_LABEL_KEY[b.id])}
                </span>
                <span
                  style={{
                    fontFamily: outfitStack,
                    fontWeight: 800,
                    fontSize: '22px',
                    letterSpacing: '-0.02em',
                  }}
                  className="tabular-nums text-ink-2"
                >
                  {b.credits.toLocaleString()}{' '}
                  <span className="text-xs-soft font-normal text-mute-soft">
                    {t('creditsUnit')}
                  </span>
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      {/* Budget bar — Memphis yellow card */}
      <div
        style={{
          background: 'var(--canvas-bg)',
          border: '3px solid var(--canvas-card-border)',
          borderRadius: 'var(--canvas-card-radius)',
          boxShadow: 'var(--canvas-card-shadow)',
        }}
        className="mt-6 rounded-sm p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div
            style={{ fontFamily: outfitStack }}
            className="text-xs-soft font-bold uppercase tracking-[0.22em] text-ink-2"
          >
            {t('predictorBudgetLabel')}
          </div>
          <div className="text-md tabular-nums text-mute">
            <span
              style={{ fontFamily: outfitStack }}
              className={overBudget ? 'text-warning font-extrabold' : 'text-ink-2 font-extrabold'}
            >
              {totalSpent.toLocaleString()}
            </span>
            <span className="mx-1 text-mute-soft">/</span>
            <span
              style={{ fontFamily: outfitStack }}
              className="font-bold text-ink-2"
            >
              {budget.toLocaleString()}
            </span>{' '}
            <span className="text-xs-soft text-mute-soft">{t('creditsUnit')}</span>
          </div>
        </div>
        <div
          style={{
            border: '2px solid var(--canvas-card-border)',
            borderRadius: '999px',
            background: '#fff',
          }}
          className="mt-3 h-3 w-full overflow-hidden"
        >
          <div
            className={'h-full transition-[width] duration-150 ' + (overBudget ? 'bg-warning' : 'bg-[var(--canvas-accent)]')}
            style={{ width: `${pctSpent}%` }}
          />
        </div>
        <div className="mt-2 text-xs-soft tabular-nums text-ink-2">
          {t('predictorRemaining', { count: remaining.toLocaleString() })}
        </div>
      </div>

      {/* Per-feature sliders — Memphis hairline rows */}
      <div
        style={{
          background: '#fff',
          border: '3px solid var(--canvas-card-border)',
          borderRadius: 'var(--canvas-card-radius)',
          boxShadow: 'var(--canvas-card-shadow)',
        }}
        className="mt-6 flex flex-col rounded-sm px-4 py-2"
      >
        {PREDICTOR_FEATURES.map((f, idx) => {
          const count = counts[f.key] ?? 0;
          const others = totalSpent - count * f.cost;
          const maxForThis = Math.floor(Math.max(0, budget - others) / f.cost);
          const absMax = Math.max(1, Math.floor(budget / f.cost));
          const spentHere = count * f.cost;
          const isLast = idx === PREDICTOR_FEATURES.length - 1;
          return (
            <div
              key={f.key}
              style={{
                borderBottom: isLast
                  ? 'none'
                  : '1.5px solid var(--canvas-card-border)',
              }}
              className="py-3 transition-colors hover:bg-[var(--canvas-bg)]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  style={{ fontFamily: outfitStack }}
                  className="text-md font-bold text-ink-2"
                >
                  {tSidebar(f.key)}
                </span>
                <span className="text-sm tabular-nums text-mute">
                  {t('predictorPerUse', { cost: f.cost })}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Slider
                  min={0}
                  max={absMax}
                  step={1}
                  value={count}
                  onChange={(e) => setCount(f.key, Number(e.target.value))}
                  className="flex-1"
                  aria-label={tSidebar(f.key)}
                />
                <div className="min-w-[110px] text-right text-md tabular-nums">
                  <span
                    style={{ fontFamily: outfitStack }}
                    className="font-extrabold text-ink-2"
                  >
                    {t('predictorUses', { count })}
                  </span>
                  <span className="ml-1 text-xs-soft text-mute-soft">
                    ({spentHere.toLocaleString()} {t('creditsUnit')})
                  </span>
                </div>
              </div>
              {count >= maxForThis && maxForThis < absMax && !overBudget && (
                <div className="mt-1 text-xs text-mute-soft">
                  {t('predictorAtCap')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 max-w-[820px] text-sm leading-[1.7] text-mute-soft">
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
