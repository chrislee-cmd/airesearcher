// POST /api/share/viewer/otp — 공유 뷰어 이메일 OTP 발송 (앱 자체 코드 + Resend/앱
// transactional 이메일).
//
// {token, email} → 토큰이 유효(미폐기·미만료)하고 email 이 초대 allow-list 에
// 있을 때만 앱이 6자리 코드를 발급해 share_view_otps 에 해시로 저장하고 org 초대와
// 같은 앱 transactional 이메일(Gmail SMTP)로 보낸다. 그 외에는 아무것도 보내지
// 않지만 응답은 항상 동일한 {ok:true} — 이메일이 초대됐는지 여부를 응답으로
// 노출하지 않아(enumeration 방지) 데이터 노출 0 원칙을 지킨다.
//
// 왜 Supabase Auth signInWithOtp 를 버렸나: 내장 이메일이 시간당 하드캡으로
// 전달에 실패해 코드가 도착하지 않는 P0 회귀가 반복됐다(2026-07-09, 2026-08-07).
// org 초대가 쓰는 앱 transactional 경로로 통일해 신뢰성을 확보한다.
//
// 🔒 세션 미생성: 앱 로그인 세션을 만들지 않는다. 코드 검증은 verify 라우트가
// share_view_otps 대조로 수행하고, 성공 시 기존 뷰어 서명 쿠키를 발급한다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertInvitedViewer, normalizeEmail } from '@/lib/share/shared-views';
import {
  generateOtpCode,
  hashOtpCode,
  otpExpiresAt,
  OTP_TTL_MIN,
} from '@/lib/share/share-otp';
import { sendShareOtpEmail } from '@/lib/share/share-otp-email';
import {
  rateLimit,
  rateLimitResponse,
  getClientIp,
  LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';

// 이메일 카피 로케일 — 뷰어 언어로 코드 메일을 보낸다. 화이트리스트 매칭만
// 신뢰(오염 방지). org 초대와 동일하게 4로케일 지원.
const LOCALES = ['ko', 'en', 'ja', 'th'] as const;

const Body = z.object({
  token: z.string().min(16).max(64),
  email: z.string().email(),
  // 코드 메일을 뷰어 언어로 보내기 위한 로케일. 없으면 기본 로케일로 폴백
  // (회귀 방지 — 구버전 클라이언트도 동작).
  locale: z.enum(LOCALES).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token, locale = 'ko' } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  // 요청자 단위 rate limit — 발송을 시도하기 전에, 또 초대 여부를 확인하기
  // 전에 먼저 막는다. 키는 (ip:token) 로 요청자 본인 빈도만 반영하고 email 을
  // 넣지 않는다 → 초대된 이메일에만 다른 응답을 주는 leak 을 원천 차단
  // (enumeration 보호). 초대/미초대 모두 동일하게 카운트되므로 429 응답도
  // 초대 여부와 무관하게 동일하다.
  const ip = getClientIp(req);
  const [perLink, perIp] = await Promise.all([
    rateLimit(`${ip}:${token}`, 'share-otp', LIMITS.shareOtp.limit, LIMITS.shareOtp.window),
    rateLimit(ip, 'share-otp:ip', LIMITS.shareOtpHourly.limit, LIMITS.shareOtpHourly.window),
  ]);
  const limited = !perLink.success ? perLink : !perIp.success ? perIp : null;
  if (limited) {
    // 서버 로그 관측성 — 클라 응답 shape 은 불변.
    console.warn('[share/otp] throttled', {
      retryAfter: limited.retryAfter,
    });
    return rateLimitResponse(limited);
  }

  // 초대·토큰 유효성을 먼저 확인 — 통과할 때만 실제로 코드를 발급/발송한다.
  const admin = createAdminClient();
  const gate = await assertInvitedViewer(admin, token, email);
  if (gate.ok) {
    const sharedViewId = gate.share.id;
    const code = generateOtpCode();
    const codeHash = hashOtpCode(sharedViewId, email, code);

    // 재발송은 이전 코드를 대체한다 — (링크, 이메일) 활성 코드는 항상 1건.
    // best-effort: 삭제 실패해도 발송을 막지 않는다(가장 최근 코드가 유효).
    await admin
      .from('share_view_otps')
      .delete()
      .eq('shared_view_id', sharedViewId)
      .eq('email', email);
    const { error: insertError } = await admin.from('share_view_otps').insert({
      shared_view_id: sharedViewId,
      email,
      code_hash: codeHash,
      expires_at: otpExpiresAt(),
    });
    if (insertError) {
      // 저장 실패 시 코드를 보내지 않는다(검증 불가한 코드 발송 방지).
      // 응답 shape 은 그대로 {ok:true} 라 enumeration 보호는 유지된다.
      console.error('[share/otp] otp persist failed', { code: insertError.code });
    } else {
      // 카피는 뷰어 로케일로 사전 번역(WRITING.md SSOT). 코드는 메일 본문에만
      // 담기고 서버 로그에는 절대 남기지 않는다(PII).
      const t = await getTranslations({ locale, namespace: 'ShareOtpEmail' });
      const mail = await sendShareOtpEmail({
        toEmail: email,
        subject: t('subject'),
        text: t('body', { code, minutes: OTP_TTL_MIN }),
      });
      if (!mail.ok) {
        // 관측성 — 발송 실패를 삼키지 않고 서버 로그에 남긴다(코드 미기록).
        console.error('[share/otp] send failed', { reason: mail.error });
      }
    }
  }

  // 초대 여부와 무관하게 동일 응답(enumeration 방지).
  return NextResponse.json({ ok: true });
}
