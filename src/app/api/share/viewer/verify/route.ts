// POST /api/share/viewer/verify — OTP 코드 검증 + 게이트 통과 시 뷰어 쿠키 발급.
//
// {token, email, code} → share_view_otps 에 저장된 해시와 대조해 코드를
// 검증(이메일 소유권 증명 — 코드는 그 이메일로만 발송됨)한 뒤, 검증된 이메일이
// 초대 allow-list 에 있으면(assertInvitedViewer) 짧은 수명의 서명 쿠키를 심는다.
// 페이지 서버 컴포넌트가 이 쿠키로 재열람을 허용한다.
//
// 왜 Supabase Auth verifyOtp 를 버렸나: 발송을 앱 자체 코드(share_view_otps)로
// 이관했으므로 검증도 앱 코드 대조로 통일한다(otp/route.ts 참고).
//
// 🔒 enumeration 보호: 코드 검증을 **먼저** 한다. share_view_otps 행은 초대된
// 이메일에만 발급되므로, 미초대 이메일은 대조할 코드가 없어 항상 invalid_code(401)
// 로 떨어진다 — 초대 여부가 응답으로 새지 않는다(코드 검증 후에만 초대 게이트).
//
// 🔒 세션 미생성: sb-* 앱 세션 쿠키를 심지 않는다. 발급 쿠키는 httpOnly + Secure
// + token 바인딩.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertInvitedViewer, normalizeEmail } from '@/lib/share/shared-views';
import { verifyOtpHash, OTP_MAX_ATTEMPTS } from '@/lib/share/share-otp';
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

const INVALID_CODE = NextResponse.json({ error: 'invalid_code' }, { status: 401 });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token, code } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const admin = createAdminClient();

  // 1) 토큰 → shared_view_id. 없으면 대조할 코드도 없음 → invalid_code(초대
  // 여부·링크 존재를 구분 노출하지 않는다).
  const { data: share } = await admin
    .from('shared_views')
    .select('id')
    .eq('token', token)
    .maybeSingle();
  if (!share) return INVALID_CODE;

  // 2) (링크, 이메일) 활성 코드 조회. 미초대 이메일은 발급 이력이 없어 여기서
  // 걸린다(enumeration 보호 — 응답은 invalid_code 로 동일).
  const { data: otp } = await admin
    .from('share_view_otps')
    .select('id, code_hash, expires_at, attempts')
    .eq('shared_view_id', share.id)
    .eq('email', email)
    .maybeSingle();
  if (!otp) return INVALID_CODE;

  // 만료 — 지난 코드는 폐기하고 거부.
  if (new Date(otp.expires_at).getTime() <= Date.now()) {
    await admin.from('share_view_otps').delete().eq('id', otp.id);
    return INVALID_CODE;
  }

  // 시도횟수 상한 — brute-force 차단. 도달 시 코드 폐기 후 거부.
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await admin.from('share_view_otps').delete().eq('id', otp.id);
    return INVALID_CODE;
  }

  // 코드 대조(타이밍 안전). 불일치 시 시도횟수 증가 후 거부.
  if (!verifyOtpHash(share.id, email, code, otp.code_hash)) {
    await admin
      .from('share_view_otps')
      .update({ attempts: otp.attempts + 1 })
      .eq('id', otp.id);
    return INVALID_CODE;
  }

  // 코드 일치 — 단회 사용이므로 즉시 소비(폐기).
  await admin.from('share_view_otps').delete().eq('id', otp.id);

  // 3) 초대 게이트 — 코드 발급 후 revoke/만료/초대해제 됐을 수 있으므로 최종
  // 확인. (코드가 일치한 시점에서 email 은 이미 초대된 이메일이지만, 링크
  // revoke·만료는 이 게이트가 SSOT.)
  const gate = await assertInvitedViewer(admin, token, email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }

  // 4) 짧은 수명 서명 쿠키 발급 — 페이지가 재열람을 허용.
  const cookieStore = await cookies();
  cookieStore.set(viewerCookieName(token), signViewerCookie(token, email), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIEWER_COOKIE_TTL_MIN * 60,
  });

  return NextResponse.json({ ok: true });
}
