import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { logError } from '@/lib/observability/log-error';
import { SUBSCRIPTION_TIERS } from '@/lib/features';
import {
  createLemonSqueezyCheckout,
  determineCurrency,
  resolveLemonSqueezySubscriptionTarget,
  type LemonSqueezyLocale,
  type PaymentCurrency,
} from '@/lib/billing';

export const maxDuration = 60;

// Subscription checkout lives on its own route so the one-time credit-pack
// path (../checkout) stays untouched — no regression risk to order_created.
// It reuses the shared LS checkout builder + currency routing; a subscription
// variant makes the hosted checkout recurring automatically.
const Body = z.object({
  tier: z.enum(['solo', 'plus', 'pro']),
  locale: z.enum(['ko', 'en']).optional(),
  // Currency = payout rail. Optional — server falls back to locale/IP.
  currency: z.enum(['KRW', 'USD']).optional(),
});

function originFromRequest(req: Request): string {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', details: parsed.error.format() }, { status: 400 });
  }
  const { tier, locale, currency: requestedCurrency } = parsed.data;
  // Validate the tier against the SSOT so an unknown tier can't slip past.
  if (!SUBSCRIPTION_TIERS.some((t) => t.id === tier)) {
    return NextResponse.json({ error: 'invalid_tier' }, { status: 400 });
  }

  const apiKey = env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) {
    console.error('[billing/subscription] LEMONSQUEEZY_API_KEY missing');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  const currency: PaymentCurrency = determineCurrency(
    request.headers,
    locale ?? 'en',
    requestedCurrency,
  );

  const target = resolveLemonSqueezySubscriptionTarget(tier, currency);
  if (!target) {
    console.error(
      `[billing/subscription] lemonsqueezy target missing currency=${currency} tier=${tier}`,
    );
    await logError({
      feature: 'billing',
      code: 'subscription_checkout_503',
      message: `lemonsqueezy subscription target missing (currency=${currency} tier=${tier})`,
      context: { currency, tier, org_id: org.org_id },
    });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  const origin = originFromRequest(request);
  const checkoutLocale: LemonSqueezyLocale = locale === 'ko' ? 'ko' : 'en';

  try {
    const checkout = await createLemonSqueezyCheckout(apiKey, {
      storeId: target.storeId,
      variantId: target.variantId,
      email: user.email ?? null,
      locale: checkoutLocale,
      // Thread org + tier so the subscription webhook can grant included
      // credits + stamp org state without a pre-inserted payments row.
      custom: { org_id: org.org_id, tier },
      redirectUrl: `${origin}/${checkoutLocale}/credits?status=subscribed&tier=${tier}`,
    });

    return NextResponse.json({
      method: 'lemonsqueezy_subscription',
      tier,
      currency,
      checkoutUrl: checkout.url,
    });
  } catch (err) {
    await logError({
      feature: 'billing',
      code: 'subscription_checkout_failed',
      message: (err as Error)?.message ?? 'lemonsqueezy_error',
      context: { tier, currency, org_id: org.org_id },
    });
    return NextResponse.json(
      { error: (err as Error).message ?? 'lemonsqueezy_error' },
      { status: 500 },
    );
  }
}
