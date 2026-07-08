// POST /api/share/viewer/verify — OTP 코드 검증 + 게이트 통과 시 뷰어 쿠키 발급.
//
// {token, email, code} → Supabase 이메일 OTP 를 검증(이메일 소유권 증명)한 뒤,
// 검증된 이메일이 초대 allow-list 에 있으면(assertInvitedViewer) 짧은 수명의
// 서명 쿠키를 심는다. 페이지 서버 컴포넌트가 이 쿠키로 재열람을 허용한다.
//
// 🔒 세션 미생성: verifyOtp 는 persistSession:false 클라이언트로만 —
// sb-* 앱 세션 쿠키를 심지 않는다. 발급 쿠키는 httpOnly + Secure + token 바인딩.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertInvitedViewer, normalizeEmail } from '@/lib/share/shared-views';
import { createOtpClient } from '@/lib/share/otp-client';
import {
  signViewerCookie,
  viewerCookieName,
  VIEWER_COOKIE_TTL_MIN,
} from '@/lib/share/viewer-cookie';

export const runtime = 'nodejs';

const Body = z.object({
  token: z.string().min(16).max(64),
  email: z.string().email(),
  code: z.string().min(4).max(12),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token, code } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  // 1) OTP 검증 — 이메일 소유권 증명. 세션은 메모리에만(쿠키 미저장).
  const otp = createOtpClient();
  const { data, error } = await otp.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });
  const verifiedEmail = data?.user?.email
    ? normalizeEmail(data.user.email)
    : null;
  if (error || !verifiedEmail) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
  }

  // 2) 게이트 — 검증된 이메일이 이 토큰의 초대 allow-list 에 있는지.
  const admin = createAdminClient();
  const gate = await assertInvitedViewer(admin, token, verifiedEmail);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }

  // 3) 짧은 수명 서명 쿠키 발급 — 페이지가 재열람을 허용.
  const cookieStore = await cookies();
  cookieStore.set(viewerCookieName(token), signViewerCookie(token, verifiedEmail), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIEWER_COOKIE_TTL_MIN * 60,
  });

  return NextResponse.json({ ok: true });
}
