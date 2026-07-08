// POST /api/share/viewer/otp — 공유 뷰어 이메일 OTP 발송.
//
// {token, email} → 토큰이 유효(미폐기·미만료)하고 email 이 초대 allow-list 에
// 있을 때만 Supabase 이메일 OTP 를 보낸다. 그 외에는 아무것도 보내지 않지만
// 응답은 항상 동일한 {ok:true} — 이메일이 초대됐는지 여부를 응답으로 노출하지
// 않아(enumeration 방지) 데이터 노출 0 원칙을 지킨다.
//
// 🔒 세션 미생성: OTP 발송은 persistSession:false 인 독립 클라이언트로만.
// 앱(app) 로그인 세션을 만들지 않는다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertInvitedViewer, normalizeEmail } from '@/lib/share/shared-views';
import { createOtpClient } from '@/lib/share/otp-client';

export const runtime = 'nodejs';

const Body = z.object({
  token: z.string().min(16).max(64),
  email: z.string().email(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  // 초대·토큰 유효성을 먼저 확인 — 통과할 때만 실제로 코드를 보낸다.
  const admin = createAdminClient();
  const gate = await assertInvitedViewer(admin, token, email);
  if (gate.ok) {
    const otp = createOtpClient();
    // shouldCreateUser: 외부 뷰어는 계정이 없을 수 있으므로 shadow user 허용.
    // 실패해도 응답은 generic — 재시도 유도 문구는 클라이언트가 처리.
    await otp.auth
      .signInWithOtp({ email, options: { shouldCreateUser: true } })
      .catch(() => {});
  }

  // 초대 여부와 무관하게 동일 응답(enumeration 방지).
  return NextResponse.json({ ok: true });
}
