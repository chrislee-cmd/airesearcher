import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_BUNDLES, type CreditBundleId } from '@/lib/features';

const TaxSchema = z.object({
  bizNo: z.string().min(1).max(40),
  company: z.string().min(1).max(120),
  ceo: z.string().min(1).max(80),
  managerName: z.string().min(1).max(80),
  managerEmail: z.string().email(),
});

const Body = z.object({
  bundleId: z.enum(['starter', 'team', 'studio', 'enterprise']),
  taxInvoice: TaxSchema.optional(),
});

const TO_EMAIL = process.env.QUOTE_TO_EMAIL || 'chris.lee@meteor-research.com';

function formatKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { bundleId, taxInvoice } = parsed.data;

  const bundle = CREDIT_BUNDLES.find((b) => b.id === (bundleId as CreditBundleId));
  if (!bundle || bundle.priceKrw == null) {
    return NextResponse.json({ error: 'invalid_bundle' }, { status: 400 });
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[billing/quote] GMAIL_USER or GMAIL_APP_PASSWORD missing');
    return NextResponse.json({ error: 'email_not_configured' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  const lines: string[] = [
    'Intellicenter 크레딧 견적서 요청이 접수되었습니다.',
    '',
    `• 신청자 이메일: ${user.email}`,
    `• 신청자 ID: ${user.id}`,
    `• 번들: ${bundle.id}`,
    `• 크레딧 개수: ${bundle.credits.toLocaleString()} 크레딧`,
    `• 금액: ${formatKrw(bundle.priceKrw)}`,
    `• 세금계산서 발행 여부: ${taxInvoice ? '예' : '아니오'}`,
  ];
  if (taxInvoice) {
    lines.push(
      '',
      '— 세금계산서 정보 —',
      `• 사업자등록번호: ${taxInvoice.bizNo}`,
      `• 상호: ${taxInvoice.company}`,
      `• 대표자명: ${taxInvoice.ceo}`,
      `• 담당자명: ${taxInvoice.managerName}`,
      `• 담당자 이메일: ${taxInvoice.managerEmail}`,
    );
  }
  lines.push('', `• 접수 시각: ${new Date().toISOString()}`);

  const subject = `[Intellicenter] 크레딧 견적 요청 — ${bundle.credits.toLocaleString()} 크레딧 (${user.email})`;

  try {
    await transporter.sendMail({
      from: `Intellicenter <${gmailUser}>`,
      to: TO_EMAIL,
      replyTo: user.email,
      subject,
      text: lines.join('\n'),
    });
  } catch (err) {
    console.error('[billing/quote] gmail smtp error', err);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
