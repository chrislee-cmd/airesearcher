'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_BUNDLES,
  type CreditBundleId,
} from '@/lib/features';

function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

const BUNDLE_LABEL_KEY: Record<CreditBundleId, string> = {
  starter: 'bundleStarter',
  team: 'bundleTeam',
  studio: 'bundleStudio',
  enterprise: 'bundleEnterprise',
};

export function CreditsBundles() {
  const t = useTranslations('Credits');
  const [showStub, setShowStub] = useState(false);

  function onClickPurchase(_id: CreditBundleId) {
    // Until the payment gateway is wired we surface a "contact billing"
    // dialog with the e-mail to write to.
    setShowStub(true);
  }

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CREDIT_BUNDLES.map((b) => {
          const labelKey = BUNDLE_LABEL_KEY[b.id];
          const isContact = b.priceKrw === null;
          return (
            <div
              key={b.id}
              className={`relative flex flex-col border bg-paper p-5 [border-radius:4px] ${
                b.popular ? 'border-amore' : 'border-line'
              }`}
            >
              {b.popular && (
                <span className="absolute -top-2 left-4 bg-amore px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-paper [border-radius:2px]">
                  {t('popular')}
                </span>
              )}
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {t(labelKey)}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[28px] font-bold tracking-[-0.02em] text-ink tabular-nums">
                  {b.credits.toLocaleString()}
                </span>
                <span className="text-[11px] text-mute-soft">
                  {t('creditsUnit')}
                </span>
              </div>
              <div className="mt-4 text-[15px] font-semibold text-ink-2 tabular-nums">
                {isContact ? '—' : formatKrw(b.priceKrw!)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-mute-soft tabular-nums">
                {b.perCreditKrw !== null && (
                  <span>
                    {formatKrw(b.perCreditKrw)} {t('perCredit')}
                  </span>
                )}
                {b.discountPct > 0 && (
                  <span className="border border-amore px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore [border-radius:2px]">
                    {t('discountOff', { percent: b.discountPct })}
                  </span>
                )}
              </div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => onClickPurchase(b.id)}
                className={`mt-5 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] transition-colors duration-[120ms] [border-radius:4px] ${
                  b.popular
                    ? 'border border-ink bg-ink text-paper hover:bg-ink-2'
                    : 'border border-line text-mute hover:border-ink hover:text-ink-2'
                }`}
              >
                {isContact ? t('contactSales') : t('purchase')}
              </button>
            </div>
          );
        })}
      </div>

      {showStub && (
        <ComingSoonDialog onClose={() => setShowStub(false)} />
      )}
    </>
  );
}

function ComingSoonDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Credits');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] border border-line bg-paper [border-radius:4px]"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('pageEyebrow')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-5">
          <h3 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
            {t('comingSoonTitle')}
          </h3>
          <p className="mt-2 text-[12.5px] leading-[1.75] text-mute">
            {t('comingSoonBody')}
          </p>
          <a
            href={`mailto:${t('contactEmail')}?subject=Credit%20top-up`}
            className="mt-4 inline-block border border-ink bg-ink px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
          >
            {t('contactEmail')}
          </a>
        </div>
      </div>
    </div>
  );
}
