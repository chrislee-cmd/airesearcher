// 공유 뷰어 게이트 쿠키 — OTP 로 이메일 소유권을 증명한 뷰어에게 발급하는
// 짧은 수명의 서명 쿠키.
//
// 왜 필요한가: 게이트 검증(assertInvitedViewer)은 서버 라우트에서 일어나지만
// 실제 read-only 렌더는 페이지 서버 컴포넌트가 한다. OTP 인증 성공 후 페이지를
// 다시 그리려면 "이 뷰어는 이 token 에 대해 email 인증을 마쳤다"는 사실을
// 서버가 재확인할 수 있어야 한다. Supabase auth 세션 쿠키를 쓰면 외부 뷰어가
// 앱(app) 전체 접근 세션을 얻어버리므로(§7.12 류 부작용), 세션과 무관한 자체
// HMAC 서명 쿠키로 token+email 을 묶어 둔다.
//
// 🔒 보안: 서명 키는 서버 전용 SUPABASE_SERVICE_ROLE_KEY. 페이로드는
// token 에 바인딩되므로 다른 링크로 재사용 불가. 만료(exp)를 담아 탈취 시
// 노출 창을 제한한다. httpOnly + Secure 쿠키로만 저장(라우트에서 설정).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';
import { normalizeEmail } from './shared-views';

/** 게이트 통과 후 재열람 허용 창(분). 짧게 — 링크 공유는 세션이 아니다. */
export const VIEWER_COOKIE_TTL_MIN = 30;

/** 쿠키 이름 — token 별로 분리해 여러 링크가 서로 덮어쓰지 않게 한다. */
export function viewerCookieName(token: string): string {
  // 토큰은 URL-safe 21자(shared-views.makeShareToken) — 쿠키명에 안전.
  return `sv_${token}`;
}

function sign(payload: string): string {
  return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
    .update(payload)
    .digest('base64url');
}

/**
 * `${email}.${expMs}` 를 서명해 `${payload}.${sig}` 문자열로 반환.
 * token 을 서명 입력에 섞어 쿠키가 해당 링크에만 유효하도록 바인딩한다.
 */
export function signViewerCookie(token: string, email: string): string {
  const exp = Date.now() + VIEWER_COOKIE_TTL_MIN * 60 * 1000;
  const payload = `${normalizeEmail(email)}.${exp}`;
  const sig = sign(`${token}.${payload}`);
  return `${payload}.${sig}`;
}

/**
 * 쿠키 값 검증 — 서명·만료·token 바인딩을 확인하고 인증된 이메일을 돌려준다.
 * 무효/만료/변조면 null. 실제 초대 여부는 호출측이 assertInvitedViewer 로
 * 다시 확인해야 한다(이 쿠키는 "이메일 소유권 증명"까지만 보장).
 */
export function verifyViewerCookie(
  token: string,
  value: string | undefined,
): string | null {
  if (!value) return null;
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);

  const expected = sign(`${token}.${payload}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const sep = payload.lastIndexOf('.');
  if (sep <= 0) return null;
  const email = payload.slice(0, sep);
  const expMs = Number(payload.slice(sep + 1));
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
  return email || null;
}
