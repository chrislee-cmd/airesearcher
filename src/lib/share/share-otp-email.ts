import nodemailer from 'nodemailer';
import { env } from '@/env';

// 공유 뷰어 OTP 코드 발송 transport. org 초대(sendOrgInviteEmail)와 **같은 앱
// transactional 경로**(Gmail SMTP nodemailer)를 재사용한다 — GMAIL_USER /
// GMAIL_APP_PASSWORD 는 이미 필수 env 라 신규 인프라·시크릿이 필요 없다. 이것이
// 이 티켓의 핵심: 공유 OTP 를 불안정한 Supabase Auth 내장 이메일에서 떼어내
// 초대 메일과 동일한 신뢰성 경로로 통일한다.
//
// (스펙은 "Resend" 로 표현했으나, 이 repo 의 실제 앱 transactional 이메일 인프라
// 이자 org 초대가 쓰는 신뢰성 경로는 Gmail SMTP nodemailer 다 — 앱은 Resend SDK 를
// 직접 쓰지 않고, Resend 는 Supabase Auth 커스텀 SMTP 전용이다. PROJECT.md §8.1.
// 스펙의 근본 의도="org 초대 인프라 재사용"을 그대로 따라 그 실제 경로를 재사용한다.)
//
// 카피는 호출측이 next-intl 로 사전 번역해 넘긴다(WRITING.md SSOT) — 이 모듈은
// 인라인 문자열을 두지 않는다.
export async function sendShareOtpEmail(opts: {
  toEmail: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const gmailUser = env.GMAIL_USER;
  const gmailPass = env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    return { ok: false, error: 'email_not_configured' };
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, '') },
  });

  try {
    await transporter.sendMail({
      from: `Research-Canvas <${gmailUser}>`,
      to: opts.toEmail,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (err) {
    // 관측성 — 발송 실패를 삼키지 않고 서버 로그에 남긴다(코드는 미기록).
    console.error('[share/otp-email] gmail smtp error', err);
    return { ok: false, error: 'send_failed' };
  }
}
