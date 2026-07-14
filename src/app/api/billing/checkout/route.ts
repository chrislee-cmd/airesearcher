import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { logError } from '@/lib/observability/log-error';
import { CREDIT_BUNDLES } from '@/lib/features';
import {
  createLemonSqueezyCheckout,
  generateBankReference,
  getBankAccount,
  normalizeBizNo,
  resolveLemonSqueezyTarget,
  type LemonSqueezyLocale,
  type TaxInvoiceRequest,
} from '@/lib/billing';

const BANK_TO_EMAIL = env.QUOTE_TO_EMAIL;

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
  const gmailUser = env.GMAIL_USER;
  const gmailPass = env.GMAIL_APP_PASSWORD;
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
    'Research-Canvas 계좌이체 신청이 접수되었습니다.',
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

  const subject = `[Research-Canvas] 계좌이체 신청 — ${args.credits.toLocaleString()} 크레딧 (${args.userEmail})`;

  try {
    await transporter.sendMail({
      from: `Research-Canvas <${gmailUser}>`,
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
  bundleId: z.enum(['mini', 'starter', 'plus', 'pro', 'max']),
  method: z.enum(['lemonsqueezy', 'bank_transfer']),
  // Locale propagated from the client (next-intl). Drives the Lemon
  // Squeezy checkout UI language. Default to 'en' for anything unknown.
  locale: z.enum(['ko', 'en']).optional(),
  // NOTE(dual-rail 2026-07-14): 통화는 더 이상 클라이언트/geo 가 아니라 **결제
  // rail 이 결정**한다 — LS 카드 = USD, 계좌이체 = KRW. 구 `currency` 바디
  // 파라미터는 무시된다(zod 가 미지정 키를 strip). 남긴 이유는 구 클라이언트가
  // 여전히 보내도 400 이 안 나게 하기 위함 — 라우트는 참조하지 않는다.
  taxInvoice: TaxInvoiceSchema.optional(),
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
  const { bundleId, method, locale, taxInvoice } = parsed.data;
  const bundle = CREDIT_BUNDLES.find((b) => b.id === bundleId);
  if (!bundle) {
    return NextResponse.json({ error: 'invalid_bundle' }, { status: 400 });
  }
  // Per-rail price presence is checked at each rail below: bank transfer needs
  // priceKrw (KRW rail), LS card needs priceUsd (USD rail). A "contact sales"
  // pack (null price) is simply not purchasable on that rail.

  const taxInvoicePayload: TaxInvoiceRequest | null = taxInvoice
    ? { ...taxInvoice, bizNo: normalizeBizNo(taxInvoice.bizNo) }
    : null;

  const admin = createAdminClient();

  // ── Bank transfer rail ──────────────────────────────────────────────────
  // Bank transfer = 국내 KRW only (single account 하나은행), flat ₩500/cr 리스트
  // 기준의 볼륨할인 총액(bundle.priceKrw). dual-rail 에서 계좌이체는 KRW rail 로
  // 유지된다(제거 X). 미래 Toss(KRW) 도 이 rail 규약을 재사용한다.
  if (method === 'bank_transfer') {
    if (bundle.priceKrw == null) {
      return NextResponse.json({ error: 'invalid_bundle' }, { status: 400 });
    }
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
          currency: 'KRW',
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

  // ── Lemon Squeezy card rail ─────────────────────────────────────────────
  const apiKey = env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) {
    console.error('[billing/checkout] LEMONSQUEEZY_API_KEY missing');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  // dual-rail (2026-07-14): LS 카드 rail 은 **USD 고정**이다. 통화를 고객 geo/
  // locale 로 분기하지 않는다 — rail 이 곧 통화. LS 는 USD 스토어만 사용하고
  // (KRW 스토어는 미사용), 국내 KRW 결제는 위 계좌이체 rail 이 담당한다.
  const currency = 'USD' as const;
  const priceUsd = bundle.priceUsd;
  if (priceUsd == null) {
    // priceUsd 없는 팩(=contact sales)은 카드로 구매 불가.
    return NextResponse.json({ error: 'invalid_bundle' }, { status: 400 });
  }

  const target = resolveLemonSqueezyTarget(bundleId, currency);
  if (!target) {
    console.error(
      `[billing/checkout] lemonsqueezy USD target missing bundle=${bundleId}`,
    );
    // 관측: USD 레일 미설정(store/variant env 누락)은 사용자 결제를 막는 config 사고.
    await logError({
      feature: 'billing',
      code: 'pack_checkout_503',
      message: `lemonsqueezy USD target missing (bundle=${bundleId})`,
      context: { currency, bundle: bundleId, org_id: org.org_id },
    });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  const origin = originFromRequest(request);
  const checkoutLocale: LemonSqueezyLocale = locale === 'ko' ? 'ko' : 'en';

  // Insert payment row first so the webhook can correlate via the
  // payment_id we thread through `checkout_data.custom`. USD rail: 실 결제
  // 총액은 amount_usd 에 기록하고 amount_krw 는 0(currency='USD' 가 권위 통화).
  // `lemonsqueezy_store_id` 로 admin 대사가 rail 을 재유도 없이 그룹핑한다.
  const { data: payment, error: insertErr } = await admin
    .from('payments')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      bundle_id: bundle.id,
      credits: bundle.credits,
      amount_krw: 0,
      amount_usd: priceUsd,
      currency,
      method: 'lemonsqueezy',
      status: 'pending',
      lemonsqueezy_store_id: target.storeId,
      tax_invoice: taxInvoicePayload as unknown as object,
    })
    .select('id')
    .single();
  if (insertErr || !payment) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  try {
    const checkout = await createLemonSqueezyCheckout(apiKey, {
      storeId: target.storeId,
      variantId: target.variantId,
      email: user.email ?? null,
      locale: checkoutLocale,
      custom: { payment_id: payment.id, org_id: org.org_id },
      redirectUrl: `${origin}/${checkoutLocale}/credits?status=success&payment_id=${payment.id}`,
    });

    await admin
      .from('payments')
      .update({ lemonsqueezy_checkout_id: checkout.id })
      .eq('id', payment.id);

    return NextResponse.json({
      paymentId: payment.id,
      method: 'lemonsqueezy',
      currency,
      checkoutUrl: checkout.url,
    });
  } catch (err) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
    // 관측: 카드 체크아웃 생성 실패(LS API 오류/네트워크) — 결제 시작 자체가 깨짐.
    await logError({
      feature: 'billing',
      code: 'pack_checkout_failed',
      message: (err as Error)?.message ?? 'lemonsqueezy_error',
      context: { payment_id: payment.id, org_id: org.org_id, currency, bundle: bundleId },
    });
    return NextResponse.json(
      { error: (err as Error).message ?? 'lemonsqueezy_error' },
      { status: 500 },
    );
  }
}
