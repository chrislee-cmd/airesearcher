// 참여자 진입 게이트 — 후보자가 전화 뒷자리로 본인임을 증명하면 발급하는
// 짧은 수명의 token-바인딩 서명 쿠키. (recruiting-scheduling 참여자 뷰)
//
// 왜 필요한가: 665 의 participant_token 은 "후보자 1명 스코프"(서버 service-role)
// 이라 다른 후보자 데이터는 새지 않지만, 링크만 있으면 누구나 그 후보자 것을
// 본다. 이 게이트는 진입 시 candidate.phone 뒷자리 4자리를 대조해 "링크 소지 =
// 열람"을 "본인 = 열람"으로 좁힌다(링크 유출 방어).
//
// 🔒 보안:
//   * 서명 키는 서버 전용 SUPABASE_SERVICE_ROLE_KEY (클라 노출 없음).
//   * 페이로드에 token 을 섞어 서명하므로 다른 링크로 쿠키 재사용 불가.
//   * 만료(exp)를 담아 탈취 시 노출 창을 제한 — 세션이 아니라 짧은 재열람 창.
//   * 전화번호(뒷자리 포함)는 절대 쿠키/클라에 넣지 않는다 — 대조는 서버 전용.
// share/viewer-cookie.ts 의 이메일 게이트와 같은 HMAC 패턴을 전화 뒷자리용으로
// 미러링한 것.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

/** 게이트 통과 후 재열람 허용 창(분). 짧게 — 링크 공유는 세션이 아니다. */
export const PARTICIPANT_GATE_TTL_MIN = 30;

/** 대조하는 전화 뒷자리 길이. */
export const PHONE_TAIL_LEN = 4;

/** 쿠키 이름 — token 별로 분리해 여러 링크가 서로 덮어쓰지 않게 한다. */
export function participantGateCookieName(token: string): string {
  // participant_token 은 uuid text(36자, hex+hyphen) — 쿠키명에 안전.
  return `sp_${token}`;
}

/**
 * 전화번호에서 대조용 뒷자리를 추출. 숫자만 남기고 마지막 PHONE_TAIL_LEN 자리.
 * 등록번호가 없거나 숫자가 하나도 없으면 null(= 게이트 대조 불가).
 */
export function phoneTail(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(-PHONE_TAIL_LEN);
}

/** 사용자 입력에서 숫자만 추출한 뒷자리(마지막 PHONE_TAIL_LEN 자리). */
export function normalizeTailInput(input: string): string {
  return input.replace(/\D/g, '').slice(-PHONE_TAIL_LEN);
}

/**
 * candidate.phone 뒷자리와 사용자 입력 뒷자리를 timing-safe 비교.
 * candidate 에 전화가 없으면(tail null) 항상 false — 대조할 시크릿이 없다.
 */
export function phoneTailMatches(
  candidatePhone: string | null | undefined,
  input: string,
): boolean {
  const expected = phoneTail(candidatePhone);
  if (!expected) return false;
  const given = normalizeTailInput(input);
  if (!given || given.length !== expected.length) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sign(payload: string): string {
  return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
    .update(payload)
    .digest('base64url');
}

/**
 * `${expMs}` 를 서명해 `${payload}.${sig}` 문자열로 반환.
 * token 을 서명 입력에 섞어 쿠키가 해당 링크에만 유효하도록 바인딩한다.
 */
export function signParticipantGate(token: string): string {
  const exp = Date.now() + PARTICIPANT_GATE_TTL_MIN * 60 * 1000;
  const payload = String(exp);
  const sig = sign(`${token}.${payload}`);
  return `${payload}.${sig}`;
}

/**
 * 쿠키 값 검증 — 서명·만료·token 바인딩 확인. 유효하면 true.
 * 무효/만료/변조/누락이면 false.
 */
export function verifyParticipantGate(
  token: string,
  value: string | undefined,
): boolean {
  if (!value) return false;
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const payload = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);

  const expected = sign(`${token}.${payload}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  const expMs = Number(payload);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
  return true;
}

/**
 * 이 후보자에 대해 게이트를 강제해야 하는가 + 통과했는가.
 *   * 전화 미등록(tail null) → 대조할 시크릿이 없으므로 게이트 미강제('pass').
 *     token 스코프(665)가 유일한 보호막으로 남는다. (spec §제약 명시 기본값:
 *     phone null 이면 토큰만으로 진입 허용.)
 *   * 전화 등록 + 유효 쿠키 → 'pass'.
 *   * 전화 등록 + 쿠키 없음/무효 → 'required'(뒷자리 화면).
 */
export function participantGateStatus(
  candidatePhone: string | null | undefined,
  token: string,
  cookieValue: string | undefined,
): 'pass' | 'required' {
  if (!phoneTail(candidatePhone)) return 'pass';
  return verifyParticipantGate(token, cookieValue) ? 'pass' : 'required';
}
