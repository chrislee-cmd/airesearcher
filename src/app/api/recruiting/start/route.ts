import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const Body = z.object({
  responderUri: z.string().url(),
});

const FROM_EMAIL = 'chris.lee@meteor-research.com';
const TO_EMAIL = 'lee880728@gmail.com';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { responderUri } = parsed.data;

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    return NextResponse.json({ error: 'email_not_configured' }, { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  const subject = '[AI Researcher] 리크루팅 안내';
  const text = [
    '목적: 여행 숙박 시설 결정 과정 이해',
    '대상 : 향후 3개월 이내에 제주도나 후쿠오카 여행 계획이 있는 사람',
    '방식: 1:1 온라인 인터뷰, 60분',
    '일정 : 4월 20~24일 사이, 세부 일정 추후 협의',
    '장소 : 온라인 인터뷰',
    '조사 사례 : 현금 7만원',
    `인터뷰 신청서 링크 : ${responderUri}`,
  ].join('\n');

  try {
    await transporter.sendMail({
      from: `Meteor Research <${FROM_EMAIL}>`,
      sender: gmailUser,
      to: TO_EMAIL,
      replyTo: FROM_EMAIL,
      subject,
      text,
    });
  } catch (err) {
    console.error('[recruiting/start] gmail smtp error', err);
    return NextResponse.json({ error: 'email_send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to: TO_EMAIL });
}
