import { NextResponse } from 'next/server';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const Body = z.object({
  responderUri: z.string().url(),
  body: z.string().min(1).max(10_000),
  subject: z.string().min(1).max(200).optional(),
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
  const { body, subject } = parsed.data;

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

  const finalSubject = subject || '[Intellicenter] 리크루팅 안내';
  const text = body;

  try {
    await transporter.sendMail({
      from: `Meteor Research <${FROM_EMAIL}>`,
      sender: gmailUser,
      to: TO_EMAIL,
      replyTo: FROM_EMAIL,
      subject: finalSubject,
      text,
    });
  } catch (err) {
    console.error('[recruiting/start] gmail smtp error', err);
    return NextResponse.json({ error: 'email_send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to: TO_EMAIL });
}
