'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  SUBSCRIPTION_TIERS,
  includedCreditsFor,
  type SubscriptionTierId,
  type SubscriptionInterval,
} from '@/lib/features';
import { track } from '@/components/mixpanel-provider';
import { formatUsd } from '@/lib/currency';
import { Button } from '@/components/ui/button';

// Shared Outfit display stack — matches credits-bundles.tsx so the
// subscription tab reads as the same surface as the one-time packs tab.
const outfitStack = 'var(--font-outfit), var(--font-sans)';

function memphisCta(tone: 'pink' | 'paper'): CSSProperties {
  const bg = tone === 'pink' ? 'var(--canvas-accent)' : '#fff';
  const fg = tone === 'pink' ? '#fff' : '#000';
  return {
    background: bg,
    color: fg,
    border: '3px solid var(--canvas-card-border)',
    borderRadius: '10px',
    boxShadow: '4px 4px 0 var(--canvas-card-border)',
    fontFamily: outfitStack,
    fontWeight: 800,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
  };
}

function memphisGhost(active: boolean): CSSProperties {
  return {
    background: '#fff',
    color: '#000',
    border: '2.5px solid var(--canvas-card-border)',
    borderRadius: '10px',
    boxShadow: active ? '3px 3px 0 var(--canvas-card-border)' : 'none',
    fontFamily: outfitStack,
    fontWeight: 700,
  };
}

// LS subscription statuses that mean the org currently holds a live plan.
// `active` + `on_trial` are the "you have a plan right now" states; a
// `cancelled` sub that's still inside its paid period also keeps access
// until `current_period_end`, so we treat it as active for display.
const LIVE_STATUSES = new Set(['active', 'on_trial', 'cancelled', 'past_due']);

// 인기 티어 강조 — plus 를 팩의 starter 처럼 pop.
const POPULAR_TIER: SubscriptionTierId = 'plus';

type SubscriptionPlansProps = {
  // Current org subscription state (organizations 구독 컬럼, 마이그
  // 20260713154738). null/무구독이면 전 티어가 "구독하기" CTA.
  currentTier?: SubscriptionTierId | null;
  currentStatus?: string | null;
  currentPeriodEnd?: string | null;
  // LS 고객 포털 signed URL — 관리/취소/플랜 변경 위임 대상. null 이면
  // billing 이메일 문의로 graceful fallback.
  managePortalUrl?: string | null;
  supportEmail: string;
};

export function SubscriptionPlans({
  currentTier = null,
  currentStatus = null,
  currentPeriodEnd = null,
  managePortalUrl = null,
  supportEmail,
}: SubscriptionPlansProps) {
  const t = useTranslations('Credits');
  const locale = useLocale();

  // Subscriptions are LS-card / USD only (계좌이체 미제공). The only pricing
  // lever is monthly vs annual — annual = 1개월 무료 (ANNUAL_FREE_MONTHS),
  // priced from the SSOT `annualPriceUsd`. Named `billingInterval` to avoid
  // shadowing the global `setInterval`.
  const [billingInterval, setBillingInterval] = useState<SubscriptionInterval>('month');
  const isAnnual = billingInterval === 'year';

  const [submittingTier, setSubmittingTier] = useState<SubscriptionTierId | null>(null);
  // Once a checkout returns 503 (variant 미구성) we lock the CTAs and show a
  // "준비 중" note instead of letting the user keep bouncing off a hard error.
  const [unavailable, setUnavailable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const isSubscribed =
    currentTier != null &&
    currentStatus != null &&
    LIVE_STATUSES.has(currentStatus);

  const renewLabel =
    currentPeriodEnd != null
      ? new Date(currentPeriodEnd).toLocaleDateString(locale, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
      : null;

  function selectInterval(next: SubscriptionInterval) {
    if (next === billingInterval) return;
    setBillingInterval(next);
    track('subscription_interval_toggle', { interval: next });
  }

  function goToPortal() {
    if (managePortalUrl) {
      window.location.assign(managePortalUrl);
    } else {
      // Graceful fallback — no signed portal URL resolved server-side.
      window.location.href = `mailto:${supportEmail}?subject=Subscription%20management`;
    }
  }

  async function subscribe(tier: SubscriptionTierId) {
    track('subscription_subscribe_click', { tier, interval: billingInterval });
    setSubmittingTier(tier);
    try {
      const res = await fetch('/api/billing/subscription/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tier,
          locale: locale === 'ko' ? 'ko' : 'en',
          // 월/연 계약 — 연간은 annual variant(USD) 로 라우팅된다
          // (resolveLemonSqueezySubscriptionTarget).
          interval: billingInterval,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 503) {
          setUnavailable(true);
          setToast(t('subUnavailableToast'));
        } else {
          setToast(json.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      if (json.checkoutUrl) {
        window.location.assign(json.checkoutUrl);
        return;
      }
      // No URL but 2xx — treat as unavailable rather than a silent no-op.
      setUnavailable(true);
      setToast(t('subUnavailableToast'));
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSubmittingTier(null);
    }
  }

  return (
    <section aria-labelledby="subscription-heading">
      <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="subscription-heading"
            style={{ fontFamily: outfitStack, letterSpacing: '-0.02em' }}
            className="text-2xl font-extrabold text-ink-2"
          >
            {t('subSectionTitle')}
          </h2>
          <p className="mt-2 max-w-[560px] text-md leading-[1.7] text-mute">
            {t('subSectionSubtitle')}
          </p>
        </div>
        {/* 월/연 토글 — 연간 = 1개월 무료. 연 선택 시 카드 가격/포함
            크레딧이 annual SSOT 로 전환되고 checkout 에 interval='year' 전달. */}
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('subIntervalLabel')} className="inline-flex gap-2">
            {(['month', 'year'] as const).map((iv) => {
              const active = iv === billingInterval;
              return (
                <Button
                  key={iv}
                  variant="ghost"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => selectInterval(iv)}
                  style={{
                    ...memphisGhost(active),
                    background: active ? '#fff0f4' : '#fff',
                    color: '#000',
                  }}
                  className="px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] rounded-sm"
                >
                  {t(iv === 'month' ? 'subIntervalMonthly' : 'subIntervalAnnual')}
                </Button>
              );
            })}
          </div>
          <span
            style={{
              background: 'var(--canvas-accent)',
              border: '2px solid var(--canvas-card-border)',
              boxShadow: 'var(--memphis-shadow-xs)',
              fontFamily: outfitStack,
            }}
            className="rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-[0.08em] text-paper"
          >
            {t('subAnnualBadge')}
          </span>
        </div>
      </div>

      {/* Current-plan banner — shown only when the org holds a live sub. */}
      {isSubscribed && (
        <div
          style={{
            background: 'var(--canvas-bg)',
            border: '3px solid var(--canvas-card-border)',
            borderRadius: 'var(--canvas-card-radius)',
            boxShadow: '4px 4px 0 var(--canvas-card-border)',
            fontFamily: outfitStack,
          }}
          className="mt-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4 rounded-sm"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-ink-2">
              {t('subCurrentPlan')}
            </div>
            <div className="mt-1 text-lg font-extrabold text-ink-2">
              {t(`subTier_${currentTier}`)}
              {currentStatus === 'cancelled' && renewLabel ? (
                <span className="ml-2 text-md font-semibold text-mute">
                  {t('subCancelledNote', { date: renewLabel })}
                </span>
              ) : renewLabel ? (
                <span className="ml-2 text-md font-semibold text-mute">
                  {t('subRenewsOn', { date: renewLabel })}
                </span>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPortal}
            style={memphisGhost(true)}
            className="px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] rounded-sm"
          >
            {t('subManage')}
          </Button>
        </div>
      )}

      {unavailable && (
        <p className="mt-6 text-md font-semibold text-mute">
          {t('subUnavailableNote')}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {SUBSCRIPTION_TIERS.map((tier) => {
          const popular = tier.id === POPULAR_TIER;
          const isCurrent = isSubscribed && tier.id === currentTier;
          // All figures SSOT-derived per selected interval — annual reads the
          // `annualPriceUsd` / `annualIncludedCredits` columns (1개월 무료 이미
          // 반영), monthly reads the base columns. USD only (no FX, no KRW).
          const priceUsd = isAnnual ? tier.annualPriceUsd : tier.monthlyPriceUsd;
          const includedCredits = includedCreditsFor(tier, billingInterval);
          const perCreditUsd = priceUsd / includedCredits;
          const effectiveMonthlyUsd = tier.annualPriceUsd / 12;
          return (
            <div
              key={tier.id}
              style={{
                background: popular ? '#fff0f4' : '#ffffff',
                border: `${popular ? '4px' : '3px'} solid var(--canvas-card-border)`,
                borderRadius: 'var(--canvas-card-radius)',
                boxShadow: 'var(--canvas-card-shadow)',
              }}
              className="relative flex flex-col p-5 rounded-sm"
            >
              {popular && !isCurrent && (
                <span
                  style={{
                    background: 'var(--canvas-accent)',
                    border: '2.5px solid var(--canvas-card-border)',
                    boxShadow: 'var(--memphis-shadow-xs)',
                    transform: 'rotate(-3deg)',
                    fontFamily: outfitStack,
                  }}
                  className="absolute -top-3 left-4 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-[0.18em] text-paper"
                >
                  {t('popular')}
                </span>
              )}
              {isCurrent && (
                <span
                  style={{
                    background: '#000',
                    border: '2.5px solid var(--canvas-card-border)',
                    boxShadow: 'var(--memphis-shadow-xs)',
                    transform: 'rotate(-3deg)',
                    fontFamily: outfitStack,
                  }}
                  className="absolute -top-3 left-4 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-[0.18em] text-paper"
                >
                  {t('subCurrentBadge')}
                </span>
              )}

              <div
                style={{ fontFamily: outfitStack }}
                className="text-xs font-bold uppercase tracking-[0.22em] text-ink-2"
              >
                {t(`subTier_${tier.id}`)}
              </div>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span
                  style={{
                    fontFamily: outfitStack,
                    fontWeight: 800,
                    fontSize: '38px',
                    lineHeight: 1,
                    letterSpacing: '-0.035em',
                  }}
                  className="text-ink-2 tabular-nums"
                >
                  {formatUsd(priceUsd)}
                </span>
                <span className="text-sm font-semibold text-mute-soft">
                  {isAnnual ? t('subPerYear') : t('subPerMonth')}
                </span>
              </div>

              {/* 연간: "연 $88 = 월 $7.33" effective 표시 — 무만료 연 지급의
                  월 환산가로 실 절약을 눈에 보이게. 월간엔 표시 안 함. */}
              {isAnnual && (
                <div className="mt-1 text-xs-soft font-semibold text-amore tabular-nums">
                  {t('subAnnualEffective', {
                    annual: formatUsd(tier.annualPriceUsd),
                    monthly: formatUsd(effectiveMonthlyUsd),
                  })}
                </div>
              )}

              <div className="mt-4 text-lg font-bold text-ink-2 tabular-nums">
                {isAnnual
                  ? t('subIncludedCreditsAnnual', { count: includedCredits })
                  : t('subIncludedCredits', { count: includedCredits })}
              </div>
              <div className="mt-1 text-xs-soft text-mute tabular-nums">
                {formatUsd(perCreditUsd)} {t('perCredit')}
              </div>

              <ul className="mt-4 flex flex-col gap-2 text-md text-mute">
                <li className="flex items-start gap-2">
                  <span aria-hidden className="text-amore">✓</span>
                  {t('subBenefitNoExpiry')}
                </li>
                <li className="flex items-start gap-2">
                  <span aria-hidden className="text-amore">✓</span>
                  {t('subBenefitPriority')}
                </li>
                <li className="flex items-start gap-2">
                  <span aria-hidden className="text-amore">✓</span>
                  {t('subBenefitSeats')}
                </li>
              </ul>

              <div className="flex-1" />

              {isCurrent ? (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={goToPortal}
                  style={memphisGhost(true)}
                  className="mt-6 uppercase"
                >
                  {t('subManage')}
                </Button>
              ) : isSubscribed ? (
                // Already on a plan → changing tier is delegated to the LS
                // portal (avoids creating a second parallel subscription).
                <Button
                  variant="ghost"
                  size="md"
                  onClick={goToPortal}
                  style={memphisGhost(false)}
                  className="mt-6 uppercase"
                >
                  {t('subChangePlan')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  disabled={unavailable || submittingTier != null}
                  onClick={() => subscribe(tier.id)}
                  style={memphisCta(popular ? 'pink' : 'paper')}
                  className="mt-6 uppercase"
                >
                  {submittingTier === tier.id
                    ? t('submitting')
                    : unavailable
                    ? t('subUnavailableCta')
                    : t('subCta')}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-toast -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div
            style={{
              background: '#000',
              border: '3px solid #000',
              boxShadow: '4px 4px 0 var(--canvas-accent)',
              fontFamily: outfitStack,
            }}
            className="px-4 py-2 text-md font-bold text-paper rounded-sm"
          >
            {toast}
          </div>
        </div>
      )}
    </section>
  );
}
