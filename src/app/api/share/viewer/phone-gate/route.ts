// POST /api/share/viewer/phone-gate — 공유 뷰어 뒷자리 진입 게이트.
//
// {token, last4} → 토큰이 유효(미폐기·미만료)하고 그 링크의 초대(invite) 중
// phone_last4 가 입력 뒷자리와 정확히 1건 일치하면, 그 attendee 로 바인딩된
// 짧은 수명의 서명 쿠키를 심는다. 페이지 서버 컴포넌트가 이 쿠키로 attendee
// 신원을 복원해 재열람을 허용한다(PR-C 채팅 격리의 기반).
//
// 🔒 보안 모델(스펙 하드요구):
//   · 뒷자리(4자리 = 1만 조합)는 약한 시크릿 — 진짜 시크릿은 링크(token).
//   · attendee 신원은 **서버에서만** 도출(assertViewerAttendeeByLast4). 요청
//     body 의 attendee 식별자는 신뢰하지 않는다.
//   · rate-limit + lockout(ip:token 분당 캡 + ip 시간당 backstop) 으로 무차별
//     대입을 막는다. 시도는 서버 로그로 관측(응답 shape 은 불변).
//   · enumeration 방지: 무효 토큰/무매칭/뒷자리 충돌 모두 동일한 generic 401
//     — 존재 여부·초대 여부를 응답으로 노출하지 않는다.
//   · 세션 미생성: Supabase auth 세션 쿠키를 심지 않는다(자체 HMAC 쿠키만).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  assertViewerAttendeeByLast4,
  normalizePhone,
  PHONE_GATE_DIGITS,
} from '@/lib/share/shared-views';
import {
  signAttendeeCookie,
  viewerCookieName,
  VIEWER_COOKIE_TTL_MIN,
} from '@/lib/share/viewer-cookie';
import {
  rateLimit,
  rateLimitResponse,
  getClientIp,
  LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';

const Body = z.object({
  token: z.string().min(16).max(64),
  // 뒷자리 — 표기 흔들림(공백 등)을 서버에서 정규화하므로 관대하게 받고
  // 아래에서 숫자 PHONE_GATE_DIGITS 자리로 강제한다.
  last4: z.string().min(PHONE_GATE_DIGITS).max(16),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token } = parsed.data;

  // 입력 정규화 — 숫자만, 그중 마지막 PHONE_GATE_DIGITS 자리를 뒷자리로 본다.
  const digits = normalizePhone(parsed.data.last4);
  if (digits.length < PHONE_GATE_DIGITS) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const last4 = digits.slice(-PHONE_GATE_DIGITS);

  // rate-limit — 매핑을 확인하기 **전에** 먼저 막는다. 키는 (ip:token) + ip.
  // 뒷자리를 키에 넣지 않아 정답/오답 시도가 동일하게 카운트(enumeration 무해).
  const ip = getClientIp(req);
  const [perLink, perIp] = await Promise.all([
    rateLimit(
      `${ip}:${token}`,
      'share-phone-gate',
      LIMITS.sharePhoneGate.limit,
      LIMITS.sharePhoneGate.window,
    ),
    rateLimit(
      ip,
      'share-phone-gate:ip',
      LIMITS.sharePhoneGateHourly.limit,
      LIMITS.sharePhoneGateHourly.window,
    ),
  ]);
  const limited = !perLink.success ? perLink : !perIp.success ? perIp : null;
  if (limited) {
    // 서버 로그 관측성 — lockout 발동을 남긴다. 클라 응답 shape 은 불변.
    console.warn('[share/phone-gate] throttled', {
      retryAfter: limited.retryAfter,
    });
    return rateLimitResponse(limited);
  }

  // 서버에서만 attendee 도출. 실패 사유는 서버 로그로만, 응답은 generic.
  const admin = createAdminClient();
  const gate = await assertViewerAttendeeByLast4(admin, token, last4);
  if (!gate.ok) {
    if (gate.reason === 'ambiguous') {
      // 뒷자리 충돌 — 호스트가 전체번호 유일성으로 해소해야 함. 관측만.
      console.warn('[share/phone-gate] ambiguous last4 — host must disambiguate');
    }
    // 무효 토큰/무매칭/충돌/폐기/만료 전부 동일 응답(enumeration 방지).
    return NextResponse.json({ error: 'invalid' }, { status: 401 });
  }

  // 통과 — attendee 바인딩 서명 쿠키 발급. 페이지가 이 신원으로 재열람 허용.
  const cookieStore = await cookies();
  cookieStore.set(
    viewerCookieName(token),
    signAttendeeCookie(token, gate.attendeeId),
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: VIEWER_COOKIE_TTL_MIN * 60,
    },
  );

  return NextResponse.json({ ok: true });
}
