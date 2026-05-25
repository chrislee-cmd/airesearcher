import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { CREDIT_BUNDLES, type CreditBundleId } from '@/lib/features';
import {
  generateBankReference,
  getBankAccount,
  getCreem,
  getCreemProductId,
  normalizeBizNo,
  type TaxInvoiceRequest,
} from '@/lib/billing';

const BANK_TO_EMAIL = process.env.QUOTE_TO_EMAIL || 'chris.lee@meteor-research.com';

function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

/**
 * Send the bank-transfer details to the admin inbox and CC the requester.
 * Returns true on send success, false on any failure — the caller falls
 * back to surfacing the bank info inline so the user is never stuck.
 */
async function sendBankTransferEmail(args: {
  userEmail: string;
  userId: string;
  bundleId: string;
  credits: number;
  amountKrw: number;
  bankReference: string;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  taxInvoice: TaxInvoiceRequest | null;
}): Promise<boolean> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[billing/checkout] GMAIL_USER or GMAIL_APP_PASSWORD missing');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  const lines: string[] = [
    'Research-mochi 계좌이체 신청이 접수되었습니다.',
    '',
    `• 신청자 이메일: ${args.userEmail}`,
    `• 신청자 ID: ${args.userId}`,
    `• 번들: ${args.bundleId}`,
    `• 크레딧 개수: ${args.credits.toLocaleString()} 크레딧`,
    `• 결제 금액: ${formatKrw(args.amountKrw)}`,
    '',
    '— 입금 안내 —',
    `• 은행: ${args.bankName ?? '(미설정 — 운영팀 환경변수 확인)'}`,
    `• 계좌번호: ${args.accountNumber ?? '(미설정)'}`,
    `• 예금주: ${args.accountHolder ?? '(미설정)'}`,
    `• 입금자명(필수): ${args.bankReference}`,
    '',
    `• 세금계산서 발행 여부: ${args.taxInvoice ? '예' : '아니오'}`,
  ];
  if (args.taxInvoice) {
    lines.push(
      '',
      '— 세금계산서 정보 —',
      `• 사업자등록번호: ${args.taxInvoice.bizNo}`,
      `• 상호: ${args.taxInvoice.company}`,
      `• 대표자명: ${args.taxInvoice.ceo}`,
      `• 담당자명: ${args.taxInvoice.managerName}`,
      `• 담당자 이메일: ${args.taxInvoice.managerEmail}`,
    );
  }
  lines.push('', `• 접수 시각: ${new Date().toISOString()}`);

  const subject = `[Research-mochi] 계좌이체 신청 — ${args.credits.toLocaleString()} 크레딧 (${args.userEmail})`;

  try {
    await transporter.sendMail({
      from: `Research-mochi <${gmailUser}>`,
      to: BANK_TO_EMAIL,
      cc: args.userEmail,
      replyTo: args.userEmail,
      subject,
      text: lines.join('\n'),
    });
    return true;
  } catch (err) {
    console.error('[billing/checkout] gmail smtp error', err);
    return false;
  }
}

export const maxDuration = 60;

const TaxInvoiceSchema = z.object({
  bizNo: z.string().min(10).max(14),
  company: z.string().min(1).max(120),
  ceo: z.string().min(1).max(60),
  managerName: z.string().min(1).max(60),
  managerEmail: z.string().email(),
  bizCertPath: z.string().optional(),
});

const Body = z.object({
  bundleId: z.enum(['starter', 'team', 'studio']),
  method: z.enum(['creem', 'bank_transfer']),
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
        // Send bank details via email (admin TO, requester CC) so the
        // checkout response can stay minimal. If the email fails for any
        // reason — missing Gmail creds, SMTP timeout — fall back to
        // returning the bank info inline so the user is never stuck.
        const emailed = await sendBankTransferEmail({
          userEmail: user.email ?? '(no email)',
          userId: user.id,
          bundleId: bundle.id,
          credits: bundle.credits,
          amountKrw: bundle.priceKrw,
          bankReference: data.bank_reference,
          bankName: account?.bankName ?? null,
          accountNumber: account?.accountNumber ?? null,
          accountHolder: account?.accountHolder ?? null,
          taxInvoice: taxInvoicePayload,
        });
        if (emailed) {
          return NextResponse.json({
            paymentId: data.id,
            method: 'bank_transfer',
            emailed: true,
          });
        }
        // Fallback path: email did not go out, return inline bank info so
        // the user can still complete the wire. The payments row is
        // already in the DB, so the admin workflow remains intact.
        return NextResponse.json({
          paymentId: data.id,
          method: 'bank_transfer',
          emailed: false,
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

  // ── Creem card rail ─────────────────────────────────────────────────────
  const creem = getCreem();
  if (!creem) {
    console.error('[billing/checkout] CREEM_API_KEY missing');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  const productId = getCreemProductId(bundleId as CreditBundleId);
  if (!productId) {
    console.error(`[billing/checkout] CREEM_PRODUCT_${bundleId.toUpperCase()} missing`);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
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
      method: 'creem',
      status: 'pending',
      tax_invoice: taxInvoicePayload as unknown as object,
    })
    .select('id')
    .single();
  if (insertErr || !payment) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  try {
    const checkout = await creem.checkouts.create({
      productId,
      customer: { email: user.email ?? undefined },
      successUrl: `${origin}/credits?status=success&payment_id=${payment.id}`,
      metadata: { payment_id: payment.id, org_id: org.org_id },
    });

    // Store Creem checkout ID for traceability.
    await admin
      .from('payments')
      .update({ creem_checkout_id: checkout.id })
      .eq('id', payment.id);

    return NextResponse.json({
      paymentId: payment.id,
      method: 'creem',
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (err) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    return NextResponse.json(
      { error: (err as Error).message ?? 'creem_error' },
      { status: 500 },
    );
  }
}
