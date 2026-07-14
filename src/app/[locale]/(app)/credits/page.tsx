import { setRequestLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/user';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { getOrgCredits, getCreditsStatus } from '@/lib/credits';
import { env } from '@/env';
import { CreditsBundles } from '@/components/credits-bundles';
import { CreditsUsagePredictor } from '@/components/credits-usage-predictor';
import { CreditsStatusBanner } from '@/components/credits-status-banner';
import { CreditsPurchaseTabs } from '@/components/credits-purchase-tabs';
import { SubscriptionPlans } from '@/components/subscription-plans';
import type { SubscriptionTierId } from '@/lib/features';
import {
  availableLemonSqueezyCurrencies,
  determineCurrency,
  fetchLemonSqueezyCustomerPortalUrl,
} from '@/lib/billing';

// PR-D17 — pop 톤. 노랑 Memphis hero 카드 (3px border + 6px offset shadow)
// + Outfit display 잔액 64-80px. 충전 흐름 / 잔액 데이터는 그대로 — 시각만.
const outfitStack = 'var(--font-outfit), var(--font-sans)';

export default async function CreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; payment_id?: string; tier?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const t = await getTranslations('Credits');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;
  const credits = org ? await getOrgCredits(org.org_id) : null;

  // 예측기 feature 목록도 preview 게이트를 따른다 — 일반(비-unlimited) 계정엔
  // preview 위젯(recruiting·desk·interviews 등)을 시뮬레이터에서 숨긴다.
  // 예측기는 PREVIEW_FEATURES 를 자체 소비하지 않는 정적 리스트라, 캔버스와
  // 동일 게이트를 적용하도록 org flag 를 여기서 해석해 prop 으로 넘긴다.
  const isUnlimited = org ? (await getOrgFlags(org.org_id)).isUnlimited : false;

  // 만료되는 무료 grant (docs/pricing-scheme.md §5.4) — 비만료 잔액과 구분
  // 표시. getCreditsStatus 는 만료 지난 grant 를 이미 0 으로 정규화한다.
  const creditsStatus = org ? await getCreditsStatus(org.org_id) : null;
  const grantCredits = creditsStatus?.grantCredits ?? 0;
  // 만료 시각(다음달 1일 0시) 하루 전 = 마지막 사용 가능일 로 표기.
  const grantExpiryLabel =
    creditsStatus?.grantExpiresAt != null
      ? new Date(
          new Date(creditsStatus.grantExpiresAt).getTime() - 86_400_000,
        ).toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })
      : null;

  const rawStatus = sp.status;
  // `subscribed` = returned from the LS subscription checkout redirect. It
  // maps to a success banner with a subscription-specific message.
  const status: 'success' | 'cancelled' | 'subscribed' | null =
    rawStatus === 'success'
      ? 'success'
      : rawStatus === 'subscribed'
      ? 'subscribed'
      : rawStatus === 'cancelled'
      ? 'cancelled'
      : null;

  // 구독 상태 (organizations 구독 컬럼, 마이그 20260713154738). 무구독이면
  // 전 티어가 "구독하기" CTA. 활성 구독이면 현재플랜/갱신일 + 관리 링크.
  let currentTier: SubscriptionTierId | null = null;
  let currentStatus: string | null = null;
  let currentPeriodEnd: string | null = null;
  let managePortalUrl: string | null = null;
  if (org) {
    const supabase = await createClient();
    const { data: subRow } = await supabase
      .from('organizations')
      .select('subscription_tier, subscription_status, ls_subscription_id, current_period_end')
      .eq('id', org.org_id)
      .single();
    currentTier = (subRow?.subscription_tier as SubscriptionTierId | null) ?? null;
    currentStatus = (subRow?.subscription_status as string | null) ?? null;
    currentPeriodEnd = (subRow?.current_period_end as string | null) ?? null;
    // Resolve the LS self-service portal URL only when a live sub exists —
    // one external call, wrapped so any failure degrades to a mailto fallback.
    const subId = (subRow?.ls_subscription_id as string | null) ?? null;
    if (subId && env.LEMONSQUEEZY_API_KEY) {
      managePortalUrl = await fetchLemonSqueezyCustomerPortalUrl(
        env.LEMONSQUEEZY_API_KEY,
        subId,
      );
    }
  }

  // Default the purchase view to the subscription tab when the user just
  // subscribed or already holds a plan; otherwise lead with one-time packs.
  const hasLiveSub =
    currentTier != null &&
    currentStatus != null &&
    ['active', 'on_trial', 'cancelled', 'past_due'].includes(currentStatus);
  const defaultTab: 'packs' | 'subscription' =
    status === 'subscribed' || hasLiveSub ? 'subscription' : 'packs';

  // Dual-payout — pick the rail server-side (locale + Vercel geo header)
  // so the toggle defaults to the user's expected currency on first paint.
  const hdrs = await headers();
  const available = availableLemonSqueezyCurrencies();
  const initialCurrency = determineCurrency(hdrs, locale);

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <header
        style={{
          background: 'var(--canvas-bg)',
          backgroundImage: 'var(--canvas-bg-image)',
          backgroundSize: 'var(--canvas-bg-size)',
          border: '3px solid var(--canvas-card-border)',
          borderRadius: 'var(--canvas-card-radius)',
          boxShadow: 'var(--canvas-card-shadow)',
        }}
        className="rounded-sm px-6 py-7 sm:px-8 sm:py-8"
      >
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
          {t('pageEyebrow')}
        </span>

        <div className="mt-5 grid items-end gap-5 sm:grid-cols-[1fr_auto]">
          <div>
            <h1
              style={{ fontFamily: outfitStack, letterSpacing: '-0.035em' }}
              className="text-3xl font-extrabold text-ink-2 sm:text-4xl"
            >
              {t('pageTitle')}
            </h1>
            <p className="mt-3 max-w-[640px] text-md leading-[1.7] text-mute">
              {t('pageSubtitle')}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <div
              style={{ fontFamily: outfitStack }}
              className="text-xs font-bold uppercase tracking-[0.22em] text-ink-2"
            >
              {t('currentBalance')}
            </div>
            <div className="mt-2 flex items-baseline gap-2 sm:justify-end">
              <span
                style={{
                  fontFamily: outfitStack,
                  fontWeight: 800,
                  fontSize: 'clamp(56px, 8vw, 80px)',
                  lineHeight: 0.95,
                  letterSpacing: '-0.04em',
                }}
                className="text-ink-2 tabular-nums"
              >
                {credits === null ? '—' : credits.toLocaleString()}
              </span>
              <span
                style={{ fontFamily: outfitStack }}
                className="text-lg font-bold text-ink-2"
              >
                {t('creditsUnit')}
              </span>
            </div>
            {grantCredits > 0 && grantExpiryLabel && (
              <div className="mt-2 sm:text-right">
                <span
                  style={{
                    fontFamily: outfitStack,
                    background: 'var(--canvas-accent)',
                    border: '2px solid var(--canvas-card-border)',
                    boxShadow: 'var(--memphis-shadow-xs)',
                    color: '#fff',
                  }}
                  className="inline-block rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                >
                  {t('freeGrantBadge', {
                    count: grantCredits,
                    date: grantExpiryLabel,
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {status && <div className="mt-5"><CreditsStatusBanner status={status} /></div>}

      <CreditsPurchaseTabs
        defaultTab={defaultTab}
        packs={
          <CreditsBundles
            availableCurrencies={available}
            initialCurrency={initialCurrency}
          />
        }
        subscription={
          <SubscriptionPlans
            availableCurrencies={available}
            initialCurrency={initialCurrency}
            currentTier={currentTier}
            currentStatus={currentStatus}
            currentPeriodEnd={currentPeriodEnd}
            managePortalUrl={managePortalUrl}
            supportEmail={t('contactEmail')}
          />
        }
      />

      <CreditsUsagePredictor isUnlimited={isUnlimited} />
    </div>
  );
}
