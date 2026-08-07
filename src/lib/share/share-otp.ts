// 공유 뷰어 OTP — 앱 자체 코드 발급/해시/검증 (Supabase Auth 이메일 의존 제거).
//
// 그동안 공유 OTP 는 Supabase Auth 내장 이메일(signInWithOtp)로 코드를 보냈으나
// 내장 서비스의 시간당 하드캡으로 전달이 실패했다. 이제 앱이 코드를 직접 발급해
// share_view_otps 에 해시로 저장하고, org 초대와 같은 앱 transactional 이메일로
// 발송한 뒤 여기서 대조 검증한다.
//
// 🔒 코드는 평문 저장 금지 — HMAC(service_role) 해시만 저장한다. 해시 입력에
// shared_view_id·email 을 섞어(binding) 다른 링크/이메일로 재사용할 수 없게 하고,
// 서버 전용 키로 서명해 DB 유출 시에도 오프라인 브루트포스를 어렵게 한다. 낮은
// 엔트로피(6자리)는 만료(10분) + 시도횟수 상한 + 요청 rate limit 으로 보강한다.

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';
import { normalizeEmail } from './shared-views';

/** 코드 유효 창(분). 짧게 — 발급 즉시 입력하는 흐름. */
export const OTP_TTL_MIN = 10;

/** 오코드 시도 상한 — 초과 시 코드 폐기(brute-force 차단). */
export const OTP_MAX_ATTEMPTS = 5;

/** 6자리 숫자 코드. randomInt 로 균등 분포(모듈로 편향 없음). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * 코드 해시 — HMAC-SHA256(service_role, `${sharedViewId}.${email}.${code}`).
 * shared_view_id·email 바인딩으로 다른 링크/이메일 재사용 불가.
 */
export function hashOtpCode(
  sharedViewId: string,
  email: string,
  code: string,
): string {
  return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
    .update(`${sharedViewId}.${normalizeEmail(email)}.${code}`)
    .digest('base64url');
}

/** 타이밍 안전 비교 — 저장 해시 vs 입력 코드에서 파생한 해시. */
export function verifyOtpHash(
  sharedViewId: string,
  email: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = hashOtpCode(sharedViewId, email, code);
  const a = Buffer.from(expected);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 발급 만료 시각(ISO) — now()+OTP_TTL_MIN. */
export function otpExpiresAt(): string {
  return new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();
}
