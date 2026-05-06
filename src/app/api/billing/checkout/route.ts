import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { CREDIT_BUNDLES, type CreditBundleId } from '@/lib/features';
import {
  generateBankReference,
  getBankAccount,
  getStripe,
  normalizeBizNo,
  type TaxInvoiceRequest,
} from '@/lib/billing';

export const maxDuration = 60;

const TaxInvoiceSchema = z.object({
  bizNo: z.string().min(10).max(14), // accept hyphenated form
  company: z.string().min(1).max(120),
  ceo: z.string().min(1).max(60),
  managerName: z.string().min(1).max(60),
  managerEmail: z.string().email(),
  bizCertPath: z.string().optional(),
});

const Body = z.object({
  bundleId: z.enum(['starter', 'team', 'studio']),
  method: z.enum(['stripe', 'bank_transfer']),
  taxInvoice: TaxInvoiceSchema.optional(),
});

function originFromRequest(req: Request): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
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
  const { bundleId, method, taxInvoice } = parsed.data;
  const bundle = CREDIT_BUNDLES.find((b) => b.id === bundleId);
  if (!bundle || bundle.priceKrw == null) {
    return NextResponse.json({ error: 'invalid_bundle' }, { status: 400 });
  }

  const taxInvoicePayload: TaxInvoiceRequest | null = taxInvoice
    ? { ...taxInvoice, bizNo: normalizeBizNo(taxInvoice.bizNo) }
    : null;

  const admin = createAdminClient();

  // ── Bank transfer rail ──────────────────────────────────────────────────
  if (method === 'bank_transfer') {
    let bankReference = generateBankReference();
    // Retry once on the rare collision; the unique index protects us.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await admin
        .from('payments')
        .insert({
          org_id: org.org_id,
          user_id: user.id,
          bundle_id: bundle.id,
          credits: bundle.credits,
          amount_krw: bundle.priceKrw,
          method: 'bank_transfer',
          status: 'pending',
          bank_reference: bankReference,
          tax_invoice: taxInvoicePayload as unknown as object,
        })
        .select('id, bank_reference')
        .single();
      if (!error && data) {
        const account = getBankAccount();
        return NextResponse.json({
          paymentId: data.id,
          method: 'bank_transfer',
          bankReference: data.bank_reference,
          bankName: account?.bankName ?? null,
          accountNumber: account?.accountNumber ?? null,
          accountHolder: account?.accountHolder ?? null,
        });
      }
      if (error?.code === '23505') {
        bankReference = generateBankReference();
        continue;
      }
      return NextResponse.json({ error: error?.message ?? 'db_error' }, { status: 500 });
    }
    return NextResponse.json({ error: 'reference_collision' }, { status: 500 });
  }

  // ── Stripe rail ─────────────────────────────────────────────────────────
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 });
  }

  const origin = originFromRequest(request);

  // Insert payment row first so the webhook can correlate via metadata.
  const { data: payment, error: insertErr } = await admin
    .from('payments')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      bundle_id: bundle.id,
      credits: bundle.credits,
      amount_krw: bundle.priceKrw,
      method: 'stripe',
      status: 'pending',
      tax_invoice: taxInvoicePayload as unknown as object,
    })
    .select('id')
    .single();
  if (insertErr || !payment) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'krw',
            unit_amount: bundle.priceKrw,
            product_data: { name: `${bundle.credits.toLocaleString()} credits` },
          },
          quantity: 1,
        },
      ],
      customer_email: user.email ?? undefined,
      success_url: `${origin}/credits?status=success&payment_id=${payment.id}`,
      cancel_url: `${origin}/credits?status=cancelled&payment_id=${payment.id}`,
      // Both metadata keys are echoed by every Stripe webhook event under
      // `data.object.metadata` — we use payment_id to look up our row.
      metadata: { payment_id: payment.id, org_id: org.org_id },
      payment_intent_data: {
        metadata: { payment_id: payment.id, org_id: org.org_id },
      },
    });

    await admin
      .from('payments')
      .update({ stripe_session_id: session.id })
      .eq('id', payment.id);

    return NextResponse.json({
      paymentId: payment.id,
      method: 'stripe',
      checkoutUrl: session.url,
    });
  } catch (err) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    return NextResponse.json(
      { error: (err as Error).message ?? 'stripe_error' },
      { status: 500 },
    );
  }
}
