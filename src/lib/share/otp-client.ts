import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';

/**
 * 세션을 쿠키에 저장하지 않는 독립 anon Supabase 클라이언트 — 공유 뷰어
 * OTP 전용.
 *
 * 왜 별도로 두는가: 뷰어 라우트는 외부인이 이메일 OTP 로 열람만 하는
 * 곳이다. @supabase/ssr 의 cookie 기반 클라이언트로 verifyOtp 를 하면
 * sb-* 세션 쿠키가 심겨 외부 뷰어가 앱(app) 전체에 로그인돼 버린다(§7.12
 * 부작용 계열). persistSession:false 로 세션을 메모리에만 두면 OTP 발송/
 * 검증은 정상 동작하되 앱 세션은 절대 생성되지 않는다. 이메일 소유권을
 * 증명한 뒤 게이트(assertInvitedViewer)가 열람 여부를 최종 결정한다.
 */
export function createOtpClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
