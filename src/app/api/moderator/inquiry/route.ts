import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  service: z.string().min(1).max(80),
});

const TO_EMAIL = process.env.INQUIRY_TO_EMAIL || 'chris.lee@meteor-research.com';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { service } = parsed.data;

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.error('[moderator/inquiry] GMAIL_USER or GMAIL_APP_PASSWORD missing');
    return NextResponse.json({ error: 'email_not_configured' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  const subject = `[Research-mochi] ${service} 도입 문의 — ${user.email}`;
  const text = [
    'AI 모더레이터 페이지에서 도입 문의가 접수되었습니다.',
    '',
    `• 관심 서비스: ${service}`,
    `• 신청자 이메일: ${user.email}`,
    `• 신청자 ID: ${user.id}`,
    `• 접수 시각: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    await transporter.sendMail({
      from: `Research-mochi <${gmailUser}>`,
      to: TO_EMAIL,
      replyTo: user.email,
      subject,
      text,
    });
  } catch (err) {
    console.error('[moderator/inquiry] gmail smtp error', err);
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
