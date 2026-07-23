// 참여자 진입 게이트 — 공통 링크 방문자가 전화 뒷자리로 본인(=한 명의 후보자)
// 임을 증명하면 발급하는 짧은 수명의 서명 쿠키. (recruiting-scheduling 참여자 뷰)
//
// 왜 필요한가: 링크가 per-candidate 토큰에서 **프로젝트 공통 링크 1개**(share_token)
// 로 바뀌었다(BUILD-SPEC §5.1). 이제 URL 은 프로젝트만 가리키고 익명이라, 방문자가
// 누구인지는 URL 이 아니라 **전화 뒷 6자리 매칭**으로 서버가 확정한다. 매칭으로
// 확정한 candidate.id 를 이 쿠키에 서명해 담아, 이후 데이터/메시지 라우트가
// 요청 body 가 아니라 **쿠키의 candidate 로만** 스코프한다(IDOR 방어). 전화 미등록
// 후보는 대조할 뒷자리가 없어 어떤 입력에도 매칭되지 않아 진입 불가(no-phone 차단
// 승계). 시크릿이 6자리라 실질 방어는 verify 라우트의 rate-limit.
//
// 🔒 보안:
//   * 서명 키는 서버 전용 SUPABASE_SERVICE_ROLE_KEY (클라 노출 없음).
//   * 페이로드에 shareToken + candidateId 를 섞어 서명 → 다른 링크/후보로 쿠키
//     재사용 불가. 방문자가 임의 candidateId 를 주입할 수 없다(서명 필요).
//   * 만료(exp)를 담아 탈취 시 노출 창을 제한 — 세션이 아니라 짧은 재열람 창.
//   * 전화번호(뒷자리 포함)는 절대 쿠키/클라에 넣지 않는다 — 대조는 서버 전용.
// share/viewer-cookie.ts 의 이메일 게이트와 같은 HMAC 패턴을 전화 뒷자리용으로
// 미러링한 것.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

/** 게이트 통과 후 재열람 허용 창(분). 짧게 — 링크 공유는 세션이 아니다. */
export const PARTICIPANT_GATE_TTL_MIN = 30;

/** 대조하는 전화 뒷자리 길이. 표시는 ##-#### 로 그루핑(입력은 숫자 6자리). */
export const PHONE_TAIL_LEN = 6;

/** 쿠키 이름 — shareToken(프로젝트) 별로 분리해 여러 링크가 서로 덮어쓰지 않게 한다. */
export function participantGateCookieName(shareToken: string): string {
  // share_token 은 uuid text(36자, hex+hyphen) — 쿠키명에 안전.
  return `sp_${shareToken}`;
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
 * 매칭으로 확정한 candidateId 를 담아 서명한 쿠키 값 `${candidateId}.${exp}.${sig}`
 * 를 반환. shareToken + candidateId 를 서명 입력에 섞어, 다른 링크/후보로 쿠키를
 * 재사용하거나 방문자가 임의 candidateId 를 위조할 수 없게 바인딩한다.
 */
export function signParticipantGate(
  shareToken: string,
  candidateId: string,
): string {
  const exp = Date.now() + PARTICIPANT_GATE_TTL_MIN * 60 * 1000;
  const payload = `${candidateId}.${exp}`;
  const sig = sign(`${shareToken}.${payload}`);
  return `${payload}.${sig}`;
}

/**
 * 쿠키 값 검증 — 서명·만료·shareToken 바인딩 확인. 유효하면 서명으로 담긴
 * candidateId 를 돌려준다(그 방문자가 본인 확인을 통과한 후보). 무효/만료/변조/
 * 누락이면 null. candidateId 는 서명이 보증하므로(서버가 매칭 성공 시에만 발급)
 * 신뢰할 수 있으나, 데이터 라우트는 그 candidate 가 여전히 프로젝트에 속하는지
 * 한 번 더 확인한다(defense in depth).
 */
export function verifyParticipantGate(
  shareToken: string,
  value: string | undefined,
): { candidateId: string } | null {
  if (!value) return null;
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = value.slice(0, lastDot); // `${candidateId}.${exp}`
  const sig = value.slice(lastDot + 1);

  const expected = sign(`${shareToken}.${payload}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  // candidateId is a uuid (no dots) and exp is a number (no dots), so the last
  // dot in the payload cleanly separates the two.
  const sep = payload.lastIndexOf('.');
  if (sep <= 0) return null;
  const candidateId = payload.slice(0, sep);
  const expMs = Number(payload.slice(sep + 1));
  if (!candidateId) return null;
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
  return { candidateId };
}
