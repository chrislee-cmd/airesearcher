import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/observability/log-error';
import { SUBSCRIPTION_TIERS, type SubscriptionTierId } from '@/lib/features';
import {
  currencyForStoreId,
  fetchLemonSqueezySubscription,
  subscriptionPeriodKey,
  subscriptionTierForVariant,
  verifyLemonSqueezySignatureAny,
} from '@/lib/billing';

export const maxDuration = 60;

// Subscription lifecycle events carry a `subscriptions` resource in `data`
// (data.id = subscription id, data.attributes.renews_at etc.). Payment events
// (subscription_payment_success/failed/recovered) carry a `subscription-invoice`
// resource instead — handled separately so we never mistake an invoice id for a
// subscription id when syncing org state.
const SUB_LIFECYCLE_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_expired',
  'subscription_resumed',
  'subscription_paused',
  'subscription_unpaused',
]);

type AdminClient = ReturnType<typeof createAdminClient>;

function includedCreditsForTier(tier: SubscriptionTierId | null): number | null {
  if (!tier) return null;
  return SUBSCRIPTION_TIERS.find((t) => t.id === tier)?.includedCredits ?? null;
}

// Locate the org for a subscription event. Prefer the org_id threaded through
// checkout custom_data; fall back to the org already linked to this LS
// subscription id. Returns the stored tier too so we can grant even when
// custom_data is absent on a later lifecycle event.
async function orgForSubscription(
  admin: AdminClient,
  customOrgId: string | null | undefined,
  subId: string | null,
): Promise<{ id: string; subscription_tier: SubscriptionTierId | null } | null> {
  if (customOrgId) {
    const { data } = await admin
      .from('organizations')
      .select('id, subscription_tier')
      .eq('id', customOrgId)
      .maybeSingle();
    if (data) return { id: data.id, subscription_tier: (data.subscription_tier as SubscriptionTierId | null) ?? null };
  }
  if (subId) {
    const { data } = await admin
      .from('organizations')
      .select('id, subscription_tier')
      .eq('ls_subscription_id', subId)
      .maybeSingle();
    if (data) return { id: data.id, subscription_tier: (data.subscription_tier as SubscriptionTierId | null) ?? null };
  }
  return null;
}

// Idempotent grant of a tier's included credits for one billing period. The
// credit amount always comes from SUBSCRIPTION_TIERS (server SSOT) — never the
// webhook payload. Returns the RPC result (true = first grant for this period).
async function grantSubscriptionPeriod(
  admin: AdminClient,
  orgId: string,
  subId: string,
  period: string,
  tier: SubscriptionTierId,
): Promise<boolean> {
  const credits = includedCreditsForTier(tier);
  if (!credits) return false;
  const { data, error } = await admin.rpc('grant_subscription_credits', {
    p_org_id: orgId,
    p_sub_id: subId,
    p_period: period,
    p_tier: tier,
    p_credits: credits,
  });
  if (error) {
    console.error('[lemonsqueezy webhook] subscription grant failed', subId, period, error);
    throw error;
  }
  return data === true;
}

// Lemon Squeezy sends the raw JSON body and an `X-Signature` header
// containing HMAC-SHA256 of that body keyed by the signing secret you
// set when creating the webhook. We must read the body as bytes-exact
// text — JSON parsing first would change formatting and break the HMAC.
//
// Dual-payout: each LS store has its own webhook + signing secret. We
// try every configured secret (KRW / USD / legacy) and trust the first
// match; the store_id in the payload then tells us which currency rail
// the order belongs to.
export async function POST(request: Request) {
  if (
    !env.LEMONSQUEEZY_WEBHOOK_SECRET_KRW &&
    !env.LEMONSQUEEZY_WEBHOOK_SECRET_USD &&
    !env.LEMONSQUEEZY_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const sig = request.headers.get('x-signature');
  const eventName = request.headers.get('x-event-name') ?? '';
  const raw = await request.text();

  const verified = verifyLemonSqueezySignatureAny(raw, sig);
  if (!verified.ok) {
    return NextResponse.json({ error: 'signature_verification_failed' }, { status: 400 });
  }

  let event: {
    meta?: {
      event_name?: string;
      custom_data?: Record<string, string>;
      store_id?: number | string;
    };
    data?: {
      id?: string | number;
      type?: string;
      attributes?: {
        test_mode?: boolean;
        status?: string;
        renews_at?: string;
        ends_at?: string;
        variant_id?: string | number;
        store_id?: string | number;
        // subscription-invoice only
        subscription_id?: string | number;
        billing_reason?: string;
      };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Prefer the header (LS guarantees it) and fall back to the body for
  // defence in depth.
  const name = eventName || event.meta?.event_name || '';
  const admin = createAdminClient();

  // Currency rail. Secret-matched currency wins when known (dedicated
  // KRW/USD webhook secrets); otherwise derive from the payload store_id
  // (legacy single-secret setups and defence in depth).
  const storeIdRaw = event.meta?.store_id;
  const storeId = storeIdRaw == null ? null : String(storeIdRaw);
  const currency = verified.currency ?? currencyForStoreId(storeId);

  // ── One-time credit-pack orders (unchanged) ─────────────────────────────
  if (name === 'order_created') {
    const paymentId = event.meta?.custom_data?.payment_id;
    if (!paymentId) {
      return NextResponse.json({ received: true, note: 'no_payment_id' });
    }

    // Stash the LS order ID + store ID + currency for traceability
    // before granting credits. The partial unique index on
    // lemonsqueezy_order_id makes the second delivery a no-op on the
    // update + idempotent on the grant RPC.
    const orderId = event.data?.id != null ? String(event.data.id) : null;
    if (orderId) {
      const patch: Record<string, string | boolean> = {
        lemonsqueezy_order_id: orderId,
        // LS stamps test_mode on orders placed via a store's test mode. Persist
        // it so these charges self-exclude from revenue (analytics.ts) — no
        // manual marking needed. Real orders carry test_mode=false.
        is_test: event.data?.attributes?.test_mode === true,
      };
      if (storeId) patch.lemonsqueezy_store_id = storeId;
      if (currency) patch.currency = currency;
      await admin
        .from('payments')
        .update(patch)
        .eq('id', paymentId)
        .is('lemonsqueezy_order_id', null);
    }

    const { error } = await admin.rpc('grant_credits_from_payment', {
      p_payment_id: paymentId,
    });
    if (error) {
      console.error('[lemonsqueezy webhook] grant failed', paymentId, error);
      // 관측: 결제는 됐는데 크레딧 지급이 실패 — 사용자 자산 손실 직결(P0급).
      await logError({
        feature: 'billing',
        code: 'order_grant_failed',
        message: error.message,
        context: { event: name, payment_id: paymentId, order_id: orderId, currency },
      });
      return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
    }
    return NextResponse.json({ received: true, currency });
  }

  if (name === 'order_refunded') {
    // Future: mark payment refunded, deduct credits. For now we log and
    // ack so Lemon Squeezy stops retrying.
    console.warn('[lemonsqueezy webhook] order_refunded not handled', event.data?.id);
    return NextResponse.json({ received: true, note: 'refund_not_handled' });
  }

  // ── Subscription payment (initial + each renewal) ───────────────────────
  // This is the money event — it fires on every successful charge. We grant
  // the tier's included credits for the current billing period, keyed by the
  // subscription's authoritative renews_at so it dedupes with the
  // subscription_created grant of the same period.
  if (name === 'subscription_payment_success') {
    const attrs = event.data?.attributes ?? {};
    const subId = attrs.subscription_id != null ? String(attrs.subscription_id) : null;
    if (!subId) {
      return NextResponse.json({ received: true, note: 'no_subscription_id' });
    }
    const org = await orgForSubscription(admin, event.meta?.custom_data?.org_id, subId);
    if (!org) {
      return NextResponse.json({ received: true, note: 'org_not_found' });
    }

    // The invoice payload lacks renews_at — fetch the subscription for the
    // authoritative period-end (and refresh org state while we're at it).
    const apiKey = env.LEMONSQUEEZY_API_KEY;
    let renewsAt: string | null = null;
    let variantTier: SubscriptionTierId | null = null;
    if (apiKey) {
      const sub = await fetchLemonSqueezySubscription(apiKey, subId);
      if (sub) {
        renewsAt = sub.renews_at;
        variantTier = subscriptionTierForVariant(sub.variant_id);
        await admin
          .from('organizations')
          .update({
            subscription_status: sub.status,
            current_period_end: sub.renews_at,
            ls_subscription_id: subId,
          })
          .eq('id', org.id);
      }
    }

    const tier =
      (event.meta?.custom_data?.tier as SubscriptionTierId | undefined) ??
      variantTier ??
      org.subscription_tier;
    if (!tier) {
      return NextResponse.json({ received: true, note: 'tier_unresolved' });
    }

    // Period key = renews_at date. Fallback to the invoice id if the API
    // fetch was unavailable — still idempotent on LS retries of this event.
    const invoiceId = event.data?.id != null ? String(event.data.id) : null;
    const period = subscriptionPeriodKey(renewsAt) ?? (invoiceId ? `invoice:${invoiceId}` : null);
    if (!period) {
      return NextResponse.json({ received: true, note: 'no_period' });
    }

    try {
      const granted = await grantSubscriptionPeriod(admin, org.id, subId, period, tier);
      return NextResponse.json({ received: true, granted, tier, period });
    } catch (e) {
      await logError({
        feature: 'billing',
        code: 'subscription_grant_failed',
        message: e instanceof Error ? e.message : 'grant_failed',
        context: { event: name, sub_id: subId, org_id: org.id, period, tier },
      });
      return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
    }
  }

  // ── Subscription lifecycle (state sync + initial grant) ─────────────────
  if (SUB_LIFECYCLE_EVENTS.has(name)) {
    const subId = event.data?.id != null ? String(event.data.id) : null;
    const attrs = event.data?.attributes ?? {};
    const org = await orgForSubscription(admin, event.meta?.custom_data?.org_id, subId);
    if (!org || !subId) {
      return NextResponse.json({ received: true, note: 'org_or_sub_not_found' });
    }

    const tier =
      (event.meta?.custom_data?.tier as SubscriptionTierId | undefined) ??
      subscriptionTierForVariant(attrs.variant_id) ??
      org.subscription_tier;

    // Sync org subscription state from the payload. status flows straight
    // from LS ('active' | 'cancelled' | 'expired' | 'past_due' | ...), so
    // cancel/expire naturally deactivate the org without clawing back the
    // already-granted (non-expiring) credits.
    const patch: Record<string, string | null> = {
      subscription_status: attrs.status ?? null,
      ls_subscription_id: subId,
      current_period_end: attrs.renews_at ?? null,
    };
    if (tier) patch.subscription_tier = tier;
    await admin.from('organizations').update(patch).eq('id', org.id);

    // On creation, grant the first period immediately. Keyed by the same
    // renews_at date the initial payment_success will compute, so exactly one
    // of the two lands the grant and the other dedupes.
    let granted = false;
    if (name === 'subscription_created' && tier) {
      const period = subscriptionPeriodKey(attrs.renews_at);
      if (period) {
        try {
          granted = await grantSubscriptionPeriod(admin, org.id, subId, period, tier);
        } catch (e) {
          await logError({
            feature: 'billing',
            code: 'subscription_grant_failed',
            message: e instanceof Error ? e.message : 'grant_failed',
            context: { event: name, sub_id: subId, org_id: org.id, period, tier },
          });
          return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ received: true, event: name, tier: tier ?? null, granted });
  }

  // All other events acknowledged — Lemon Squeezy retries only on non-2xx.
  return NextResponse.json({ received: true, ignored: name });
}
