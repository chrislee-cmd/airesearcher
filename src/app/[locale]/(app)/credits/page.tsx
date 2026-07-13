import { setRequestLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { getOrgCredits, getCreditsStatus } from '@/lib/credits';
import { CreditsBundles } from '@/components/credits-bundles';
import { CreditsUsagePredictor } from '@/components/credits-usage-predictor';
import { CreditsStatusBanner } from '@/components/credits-status-banner';
import {
  availableLemonSqueezyCurrencies,
  determineCurrency,
} from '@/lib/billing';

// PR-D17 — pop 톤. 노랑 Memphis hero 카드 (3px border + 6px offset shadow)
// + Outfit display 잔액 64-80px. 충전 흐름 / 잔액 데이터는 그대로 — 시각만.
const outfitStack = 'var(--font-outfit), var(--font-sans)';

export default async function CreditsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; payment_id?: string }>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const t = await getTranslations('Credits');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;
  const credits = org ? await getOrgCredits(org.org_id) : null;

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
  const status: 'success' | 'cancelled' | null =
    rawStatus === 'success' ? 'success' : rawStatus === 'cancelled' ? 'cancelled' : null;

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

      <CreditsBundles
        availableCurrencies={available}
        initialCurrency={initialCurrency}
      />

      <CreditsUsagePredictor />
    </div>
  );
}
