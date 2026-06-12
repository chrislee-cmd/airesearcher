import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyLemonSqueezySignature } from '@/lib/billing';

export const maxDuration = 60;

// Lemon Squeezy sends the raw JSON body and an `X-Signature` header
// containing HMAC-SHA256 of that body keyed by the signing secret you
// set when creating the webhook. We must read the body as bytes-exact
// text — JSON parsing first would change formatting and break the HMAC.
export async function POST(request: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const sig = request.headers.get('x-signature');
  const eventName = request.headers.get('x-event-name') ?? '';
  const raw = await request.text();

  if (!verifyLemonSqueezySignature(raw, sig, secret)) {
    return NextResponse.json({ error: 'signature_verification_failed' }, { status: 400 });
  }

  let event: {
    meta?: { event_name?: string; custom_data?: Record<string, string> };
    data?: { id?: string; type?: string };
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

  if (name === 'order_created') {
    const paymentId = event.meta?.custom_data?.payment_id;
    if (!paymentId) {
      return NextResponse.json({ received: true, note: 'no_payment_id' });
    }

    // Stash the LS order ID for traceability before granting credits.
    // The partial unique index on lemonsqueezy_order_id makes the second
    // delivery a no-op on the update + idempotent on the grant RPC.
    const orderId = event.data?.id ?? null;
    if (orderId) {
      await admin
        .from('payments')
        .update({ lemonsqueezy_order_id: orderId })
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
    return NextResponse.json({ received: true });
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
