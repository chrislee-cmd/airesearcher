// AI 동시통역 — 하이브리드 C 과금 헬퍼 (서버 전용).
//
// 진행 중 wall-clock 10분 heartbeat 로 낙관적 차감(우측 상단 실시간 count-down),
// 종료 시 finalize 가 실오디오 기준(`translateCreditsForAudioSeconds`)으로 정산·
// 보정한다. 이 모듈은 세션의 각 과금 블록(start lump + 10분 tick)을 멱등하게
// 만드는 deterministic generation_id 를 유도한다 — probing heartbeat
// (`api/probing/sessions/heartbeat`) 의 SHA-256 패턴을 통역 네임스페이스로 복제.
//
// node:crypto 를 쓰므로 서버 전용. 순수 숫자 상수(START_LUMP / MAX_TICK /
// blockCredits)는 클라이언트 번들에도 들어가는 `@/lib/features` 에 있다.

import { createHash } from 'node:crypto';

// generation_id 는 `credit_transactions.generation_id uuid` 컬럼에 저장되므로
// raw 문자열을 넣을 수 없다. probing 과 동일하게 `translate:{sessionId}:tick:{n}`
// 를 SHA-256 해싱해 well-formed UUID(v4 형태)로 만든다.
//
//   tick_index 0 = start lump (go-live 시 /start 가 발급, TRANSLATE_START_LUMP_CREDITS)
//   tick_index n≥1 = n 번째 10분 heartbeat (blockCredits)
//
// `:tick:` prefix 로 기존 통역 과금 genId(`{sessionId}:revise` ·
// `{sessionId}:postprocess` · recording-id)와 네임스페이스가 완전히 분리된다.
export function deriveTranslateTickGenerationId(
  sessionId: string,
  tickIndex: number,
): string {
  const digest = createHash('sha256')
    .update(`translate:${sessionId}:tick:${tickIndex}`)
    .digest();
  const hex = digest.toString('hex');
  const v = (parseInt(hex.slice(12, 13), 16) & 0x0) | 0x4; // version = 4
  const r = (parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8; // variant = 10xx
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    v.toString(16) + hex.slice(13, 16),
    r.toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}
