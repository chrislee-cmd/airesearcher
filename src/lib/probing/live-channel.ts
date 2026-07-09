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
//
// 협업화(probing-share-collaborative-injection): #507 읽기전용 broadcast 위에
// 양방향 계약을 얹는다.
//   호스트 → 뷰어: `persona`(#507) + `think`(AI 사고 흐름 스트림).
//   뷰어 → 호스트: `inject`(추가 질문 주입 — 호스트 주입 파이프라인 트리거).
// event 이름으로 방향을 분리해 호스트 자기 outbound(persona/think) echo 문제가
// 없다(호스트는 `inject`만, 뷰어는 persona/think 만 구독). 제안 질문(suggestions)
// 은 별도 이벤트가 아니라 `persona` 스냅샷의 `questions` 필드로 이미 실린다 —
// 주입된 질문의 효과(위젯 생성·popup·think)가 persona/think 재브로드캐스트로
// 그대로 전파되므로 별도 `injected` 이벤트 없이 "동일 동작" 이 충족된다.

import { z } from 'zod';
import type { ProbingPersonaSnapshot } from '@/lib/probing-persona-snapshot';

// 채널 topic. sessionId = probing_sessions.id(공유 resource_id). 호스트·뷰어가
// 같은 함수로 파생한다.
export function probingLiveChannelName(sessionId: string): string {
  return `probing-live:${sessionId}`;
}

// ── 호스트 → 뷰어: persona 스냅샷 ──
// broadcast event 이름 — 페르소나 스냅샷 전체 송출(위젯 그리드 + 제안 질문).
export const PROBING_LIVE_PERSONA_EVENT = 'persona' as const;

// broadcast payload — 스냅샷 계약 그대로. delta 가 아니라 매 tick 전체 스냅샷을
// 보낸다(멱등, mid-join 안전, translate 의 caption delta 와 달리 상태가 작아
// 전량 송출이 저비용).
export type ProbingLivePersonaPayload = ProbingPersonaSnapshot;

// ── 호스트 → 뷰어: AI 사고 흐름(think) ──
// 페르소나와 달리 스냅샷에 없는 in-memory thinkingEvents 를 실시간 노출한다.
// persona 처럼 매 tick 전체(최근 tail)를 보내 멱등·mid-join 안전. 뷰어는
// 통째로 교체한다(순서 뒤섞임 무해). streaming 은 호스트의 "생각 중" 펄스 미러.
export const PROBING_LIVE_THINK_EVENT = 'think' as const;

export const probingLiveThinkSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        at: z.number(),
        text: z.string(),
      }),
    )
    .max(200),
  streaming: z.boolean(),
});

export type ProbingLiveThinkPayload = z.infer<typeof probingLiveThinkSchema>;

// ── 뷰어 → 호스트: 추가 질문 주입(inject) ──
// 공유 링크 보유자 누구나 주입 가능(사용자 명시 의도). 호스트가 이 이벤트를
// 구독해 자기 주입 핸들러(handleInjectQuestion)를 그대로 호출 → 위젯 생성 +
// priority_sections 가중치 + think 가 호스트가 직접 입력한 것과 동일하게 실행.
// 익명 송신자라 호스트측에서 이 스키마로 방어적 파싱 + rate-limit 한다.
export const PROBING_LIVE_INJECT_EVENT = 'inject' as const;

// research-context 의 QUESTION_MAX 와 정합(주입 질문 상한).
export const PROBING_INJECT_QUESTION_MAX = 500;

export const probingLiveInjectSchema = z.object({
  question: z.string().trim().min(1).max(PROBING_INJECT_QUESTION_MAX),
});

export type ProbingLiveInjectPayload = z.infer<typeof probingLiveInjectSchema>;
