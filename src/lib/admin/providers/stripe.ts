import type { ProviderUsage } from '../types';

// Stripe is the *revenue* side, not an API cost. We still surface the
// available + pending balance because the operator-style admin page
// wants a single place to see "what's flowing through us".
//
// Docs: https://stripe.com/docs/api/balance
const BALANCE_URL = 'https://api.stripe.com/v1/balance';

type StripeBalance = {
  available?: { amount: number; currency: string }[];
  pending?: { amount: number; currency: string }[];
};

export async function getStripeUsage(): Promise<ProviderUsage> {
  const present = !!process.env.STRIPE_SECRET_KEY;
  const envKeys = [
    { key: 'STRIPE_SECRET_KEY', present },
    {
      key: 'STRIPE_WEBHOOK_SECRET',
      present: !!process.env.STRIPE_WEBHOOK_SECRET,
    },
  ];
  const dashboardUrl = 'https://dashboard.stripe.com/balance';

  if (!present) {
    return {
      id: 'stripe',
      name: 'Stripe (수익 — 참고)',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  try {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY!}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as StripeBalance;

    // Stripe amounts are in the smallest currency unit (e.g. cents).
    // We normalize to the major unit for display; we keep KRW as-is
    // because KRW has no fractional part.
    function major(amount: number, currency: string) {
      const lower = (currency || '').toLowerCase();
      // Zero-decimal currencies per Stripe docs (subset that matters here).
      if (lower === 'krw' || lower === 'jpy') return amount;
      return amount / 100;
    }

    const available = json.available ?? [];
    const pending = json.pending ?? [];
    const formatBucket = (b: { amount: number; currency: string }[]) =>
      b
        .map((x) =>
          `${major(x.amount, x.currency).toLocaleString('ko-KR', {
            maximumFractionDigits: 2,
          })} ${x.currency.toUpperCase()}`,
        )
        .join(' · ') || '—';

    return {
      id: 'stripe',
      name: 'Stripe (수익 — 참고)',
      status: 'ok',
      periodLabel: '실시간 잔액',
      // Available is the displayable balance. Showing it again under
      // balanceLabel created a redundant "0 USD" column in the row,
      // so we keep it only as a metric and omit balanceLabel.
      metrics: [
        { label: '사용 가능', value: formatBucket(available) },
        { label: '대기 중', value: formatBucket(pending) },
      ],
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'stripe',
      name: 'Stripe (수익 — 참고)',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
