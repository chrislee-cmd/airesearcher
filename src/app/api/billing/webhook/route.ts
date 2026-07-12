import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  currencyForStoreId,
  verifyLemonSqueezySignatureAny,
} from '@/lib/billing';

export const maxDuration = 60;

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
    data?: { id?: string; type?: string; attributes?: { test_mode?: boolean } };
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

  if (name === 'order_created') {
    const paymentId = event.meta?.custom_data?.payment_id;
    if (!paymentId) {
      return NextResponse.json({ received: true, note: 'no_payment_id' });
    }

    // Stash the LS order ID + store ID + currency for traceability
    // before granting credits. The partial unique index on
    // lemonsqueezy_order_id makes the second delivery a no-op on the
    // update + idempotent on the grant RPC.
    const orderId = event.data?.id ?? null;
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

  // All other events acknowledged — Lemon Squeezy retries only on non-2xx.
  return NextResponse.json({ received: true, ignored: name });
}
