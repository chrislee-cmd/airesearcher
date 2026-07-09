// 프로빙 페르소나 공유 실시간화 — Realtime broadcast 채널 계약 SSOT.
//
// 호스트(probing-card)가 라이브 세션 중 페르소나 갱신마다 이 채널로 현재
// 스냅샷을 송출하고, 공유 뷰어(share-persona-live)가 구독해 live 재렌더한다.
// 동시통역 `live:<sessionId>` 패턴 이식(translate-console.tsx / translate-viewer.tsx):
// broadcast 채널은 DB RLS 불필요(pub/sub) 라 sb-* 세션 없는 익명 공유 뷰어도
// 수신 가능. 채널명 = sessionId(probing_sessions.id, UUID 추측 불가) 라 게이트
// 통과 뷰어에게만 서버가 tunnel → 사실상 공유키.
//
// payload = #493 스냅샷 계약(probing-persona-snapshot.ts) 재사용 — 초기/mid-join
// 상태(DB persist)와 live delta 가 동일 shape 라 뷰어가 한 렌더 경로로 처리하고,
// 파싱/검증도 한 스키마로 공유한다. 채널명/이벤트/payload 타입을 이 한 곳에서만
// 파생해 호스트·뷰어가 절대 어긋나지 않게 한다.

import type { ProbingPersonaSnapshot } from '@/lib/probing-persona-snapshot';

// 채널 topic. sessionId = probing_sessions.id(공유 resource_id). 호스트·뷰어가
// 같은 함수로 파생한다.
export function probingLiveChannelName(sessionId: string): string {
  return `probing-live:${sessionId}`;
}

// broadcast event 이름 — 채널당 이 이벤트 하나(페르소나 스냅샷 전체 송출).
export const PROBING_LIVE_PERSONA_EVENT = 'persona' as const;

// broadcast payload — 스냅샷 계약 그대로. delta 가 아니라 매 tick 전체 스냅샷을
// 보낸다(멱등, mid-join 안전, translate 의 caption delta 와 달리 상태가 작아
// 전량 송출이 저비용).
export type ProbingLivePersonaPayload = ProbingPersonaSnapshot;
