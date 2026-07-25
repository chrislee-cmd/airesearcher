// Solapi (구 CoolSMS) REST 발송 — recruiting-scheduling 공지/메시지 문자 알림용.
//
// 왜 이 파일: SMS 발송은 전화번호를 다루므로 100% 서버 전용이다(전화번호가 클라로
// 새는 경로 0 — PROJECT.md 정책). 발신은 알림형(안내+마스터링크)만 — 본문은 담지
// 않아 개인정보 노출과 SMS 단가를 동시에 관리한다(사용자 결정 2026-07-25).
//
// env 3종은 모두 optional(env.ts) — 미설정 배포에서 회귀 0. 호출부는 반드시
// isSolapiConfigured() 로 게이트한 뒤에만 sendSms 를 호출한다.
//
// 인증: Solapi v4 HMAC-SHA256. Authorization 헤더에 apiKey·date(ISO8601)·salt·
// signature 를 담고, signature = HMAC-SHA256(date + salt, apiSecret) hex.
// 참조: https://developers.solapi.com/references/authentication/api-key

import { createHmac, randomBytes } from 'node:crypto';
import { env } from '@/env';

const SOLAPI_SEND_ENDPOINT = 'https://api.solapi.com/messages/v4/send-many/detail';

// SMS(단문) 최대 바이트. 이 값을 넘으면 Solapi 는 LMS(장문)로 과금·발송한다.
// 알림형 템플릿은 마스터링크가 붙어 대개 LMS 로 넘어간다(단가 상승 감수 — 사용자
// 결정: 링크형 알림).
const SMS_MAX_BYTES = 90;

export type SolapiMessage = {
  /** 수신 번호 — 숫자만(01012345678). 정규화는 호출부 책임. */
  to: string;
  /** 발송 본문(알림형). */
  text: string;
};

export type SolapiSendResult = {
  smsSent: number;
  smsFailed: number;
};

/**
 * 3종 env 가 모두 설정됐을 때만 true. 호출부(라우트·설정 조회)는 이 게이트를
 * 통과한 뒤에만 발송을 시도하고, 미설정이면 SMS 를 조용히 스킵한다(에러 아님).
 */
export function isSolapiConfigured(): boolean {
  return Boolean(
    env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET && env.SOLAPI_SENDER_NUMBER,
  );
}

// EUC-KR 근사 바이트 길이 — Solapi 의 SMS/LMS 분기 기준과 맞춘다. ASCII(<=0x7F)
// 1바이트, 그 외(한글 등) 2바이트. 정확한 EUC-KR 인코딩이 아니라 분기 판정용 근사.
function byteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  }
  return bytes;
}

function authorizationHeader(): string {
  const apiKey = env.SOLAPI_API_KEY as string;
  const apiSecret = env.SOLAPI_API_SECRET as string;
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString('hex');
  const signature = createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * 여러 수신자에게 동일 본문을 발송(다건 배치). 본문 바이트 길이로 SMS/LMS 를
 * 명시 분기하고, LMS 는 제목을 붙인다(선택). 실패는 예외를 던지지 않고
 * { smsSent, smsFailed } 로 집계해 돌려준다 — SMS 는 best-effort 후처리라 발송
 * 실패가 상위 흐름(메시지 저장)을 막으면 안 된다(하드 제약).
 *
 * @param messages 수신 목록(각 to 는 숫자만 정규화된 상태여야 함)
 * @param subject  LMS 로 승격될 때 붙일 제목(선택). SMS 는 무시.
 */
export async function sendSms(
  messages: SolapiMessage[],
  subject?: string,
): Promise<SolapiSendResult> {
  if (messages.length === 0) return { smsSent: 0, smsFailed: 0 };
  if (!isSolapiConfigured()) {
    // 방어적: 게이트를 안 거치고 들어온 경우에도 조용히 전량 스킵(발송 0).
    return { smsSent: 0, smsFailed: messages.length };
  }

  const from = env.SOLAPI_SENDER_NUMBER as string;
  const payload = {
    messages: messages.map((m) => {
      const isLms = byteLength(m.text) > SMS_MAX_BYTES;
      return {
        to: m.to,
        from,
        text: m.text,
        type: isLms ? 'LMS' : 'SMS',
        ...(isLms && subject ? { subject } : {}),
      };
    }),
  };

  try {
    const res = await fetch(SOLAPI_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorizationHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // 전송 자체 실패(인증·발신번호 미승인 등) — 전량 실패로 집계.
      const detail = await res.text().catch(() => '');
      console.error('[solapi] send failed', res.status, detail.slice(0, 500));
      return { smsSent: 0, smsFailed: messages.length };
    }

    const json = (await res.json().catch(() => null)) as {
      failedMessageList?: unknown[];
    } | null;
    const failed = Array.isArray(json?.failedMessageList)
      ? json!.failedMessageList.length
      : 0;
    const sent = Math.max(0, messages.length - failed);
    return { smsSent: sent, smsFailed: failed };
  } catch (err) {
    console.error('[solapi] send threw', err);
    return { smsSent: 0, smsFailed: messages.length };
  }
}
