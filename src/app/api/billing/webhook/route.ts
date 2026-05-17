import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

// Creem sends raw body — must be read as text for byte-exact HMAC verification.
export async function POST(request: Request) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const sig = request.headers.get('creem-signature') ?? '';
  const raw = await request.text();

  // HMAC-SHA256 signature verification.
  const computed = createHmac('sha256', secret).update(raw).digest('hex');
  const sigBuf = Buffer.from(sig);
  const computedBuf = Buffer.from(computed);
  const valid =
    sigBuf.length === computedBuf.length &&
    timingSafeEqual(sigBuf, computedBuf);

  if (!valid) {
    return NextResponse.json({ error: 'signature_verification_failed' }, { status: 400 });
  }

  let event: { eventType: string; object: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (event.eventType === 'checkout.completed') {
    const obj = event.object;
    // payment_id is stored in the metadata we pass at checkout creation.
    const metadata = (obj.metadata ?? {}) as Record<string, string>;
    const paymentId = metadata.payment_id;

    if (!paymentId) {
      return NextResponse.json({ received: true, note: 'no_payment_id' });
    }

    // Store the Creem checkout ID for traceability before granting credits.
    const creemCheckoutId = (obj.id as string | undefined) ?? null;
    if (creemCheckoutId) {
      await admin
        .from('payments')
        .update({ creem_checkout_id: creemCheckoutId })
        .eq('id', paymentId)
        .is('creem_checkout_id', null); // skip if already set by checkout route
    }

    const { error } = await admin.rpc('grant_credits_from_payment', {
      p_payment_id: paymentId,
    });
    if (error) {
      console.error('[creem webhook] grant failed', paymentId, error);
      return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  if (event.eventType === 'refund.created') {
    // Future: mark payment refunded, deduct credits.
    return NextResponse.json({ received: true, note: 'refund_not_handled' });
  }

  // All other events acknowledged — Creem retries only on non-2xx.
  return NextResponse.json({ received: true });
}
