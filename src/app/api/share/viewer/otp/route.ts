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

// locale 은 로케일 세그먼트 오염 방지용으로 화이트리스트 매칭만 신뢰한다.
const LOCALES = ['ko', 'en'] as const;

const Body = z.object({
  token: z.string().min(16).max(64),
  email: z.string().email(),
  // 매직링크 fallback 리다이렉트를 공유 페이지로 고정하기 위한 로케일.
  // 없으면 기본 로케일로 폴백(회귀 방지 — 구버전 클라이언트도 동작).
  locale: z.enum(LOCALES).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { token, locale = 'ko' } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  // 초대·토큰 유효성을 먼저 확인 — 통과할 때만 실제로 코드를 보낸다.
  const admin = createAdminClient();
  const gate = await assertInvitedViewer(admin, token, email);
  if (gate.ok) {
    const otp = createOtpClient();
    // 🔒 emailRedirectTo: 매직링크가 이메일에 남더라도(1차 방어선은 Supabase
    // 이메일 템플릿에서 {{ .ConfirmationURL }} 제거 — 인간 액션) 앱 루트가 아닌
    // 이 공유 뷰어 페이지로만 향하게 고정한다. origin 은 요청이 실제로 도달한
    // 배포 주소에서 파생 — SITE_URL 설정에 의존하지 않는다.
    const emailRedirectTo = new URL(
      `/${locale}/share/${token}`,
      new URL(req.url).origin,
    ).toString();
    // shouldCreateUser: 외부 뷰어는 계정이 없을 수 있으므로 shadow user 허용.
    // (축소하면 계정 없는 뷰어에게 코드가 아예 안 발송되는 회귀 → 유지.)
    // 실패해도 응답은 generic — 재시도 유도 문구는 클라이언트가 처리.
    await otp.auth
      .signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo },
      })
      .catch(() => {});
  }

  // 초대 여부와 무관하게 동일 응답(enumeration 방지).
  return NextResponse.json({ ok: true });
}
