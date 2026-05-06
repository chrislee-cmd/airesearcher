import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/billing';

export const maxDuration = 60;

// Stripe sends raw body — must be read as text, not JSON, so the signature
// verification matches byte-for-byte.
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 });
  }

  const sig = request.headers.get('stripe-signature') ?? '';
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `signature_verification_failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.payment_id;
    if (!paymentId) {
      return NextResponse.json({ received: true, note: 'no_payment_id' });
    }
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true, note: `payment_status=${session.payment_status}` });
    }
    // Stamp the payment intent for traceability before granting credits.
    await admin
      .from('payments')
      .update({ stripe_payment_intent_id: session.payment_intent as string | null })
      .eq('id', paymentId);
    const { error } = await admin.rpc('grant_credits_from_payment', {
      p_payment_id: paymentId,
    });
    if (error) {
      console.error('[stripe webhook] grant failed', paymentId, error);
      return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session.metadata?.payment_id;
    if (paymentId) {
      await admin
        .from('payments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', paymentId)
        .eq('status', 'pending');
    }
    return NextResponse.json({ received: true });
  }

  // Other events ignored — Stripe will retry only non-2xx, so always 200.
  return NextResponse.json({ received: true });
}
