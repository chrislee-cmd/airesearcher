'use client';

import { useState, type ReactNode, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { track } from '@/components/mixpanel-provider';
import { Button } from '@/components/ui/button';

const outfitStack = 'var(--font-outfit), var(--font-sans)';

function tabStyle(active: boolean): CSSProperties {
  // Memphis segmented control — active tab is pink-tinted + offset shadow,
  // inactive is flat white paper. Matches the pop 톤 of the packs/sub cards.
  return {
    background: active ? '#fff0f4' : '#fff',
    color: '#000',
    border: '2.5px solid var(--canvas-card-border)',
    borderRadius: '10px',
    boxShadow: active ? '3px 3px 0 var(--canvas-card-border)' : 'none',
    fontFamily: outfitStack,
    fontWeight: 800,
  };
}

type Tab = 'packs' | 'subscription';

// Client tab wrapper: both purchase surfaces (one-time packs · monthly
// subscription) are pre-rendered as slots and only the active one is shown.
// Kept dumb on purpose — each slot owns its own checkout/currency state so
// switching tabs never resets an in-flight purchase form.
export function CreditsPurchaseTabs({
  packs,
  subscription,
  defaultTab = 'packs',
}: {
  packs: ReactNode;
  subscription: ReactNode;
  defaultTab?: Tab;
}) {
  const t = useTranslations('Credits');
  const [tab, setTab] = useState<Tab>(defaultTab);

  function select(next: Tab) {
    if (next === tab) return;
    setTab(next);
    track('credits_purchase_tab', { tab: next });
  }

  return (
    <div className="mt-8">
      <div
        role="tablist"
        aria-label={t('purchaseTabsLabel')}
        className="inline-flex gap-2"
      >
        <Button
          role="tab"
          aria-selected={tab === 'packs'}
          variant="ghost"
          size="sm"
          onClick={() => select('packs')}
          style={tabStyle(tab === 'packs')}
          className="px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] rounded-sm"
        >
          {t('tabPacks')}
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'subscription'}
          variant="ghost"
          size="sm"
          onClick={() => select('subscription')}
          style={tabStyle(tab === 'subscription')}
          className="px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] rounded-sm"
        >
          {t('tabSubscription')}
        </Button>
      </div>

      <div role="tabpanel" hidden={tab !== 'packs'}>
        {packs}
      </div>
      <div role="tabpanel" hidden={tab !== 'subscription'}>
        {subscription}
      </div>
    </div>
  );
}
