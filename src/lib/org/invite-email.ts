import nodemailer from 'nodemailer';
import { env } from '@/env';

// Transactional org-invite email transport. Reuses the app's existing Gmail
// SMTP path (same mechanism as /api/moderator/inquiry — GMAIL_USER /
// GMAIL_APP_PASSWORD are required env, so this needs no new infra). Copy is
// supplied pre-translated by the caller (localized via next-intl getTranslations
// — WRITING.md SSOT), keeping this module free of inline strings. This is a
// plain app transactional email, distinct from Supabase Auth emails (OTP /
// magic-link) which go through the dashboard-configured custom SMTP (§8.1).
export async function sendOrgInviteEmail(opts: {
  toEmail: string;
  replyTo: string;
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
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (err) {
    console.error('[org/invite-email] gmail smtp error', err);
    return { ok: false, error: 'send_failed' };
  }
}
