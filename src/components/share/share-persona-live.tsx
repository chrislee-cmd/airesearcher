'use client';

// 공유 협업 뷰어 — 초기 스냅샷(#493) 위에 실시간 broadcast 를 얹고, 우패널의
// 주입 필드로 호스트에 질문을 되쏘는 양방향 래퍼
// (probing-share-collaborative-injection, #507 위 확장).
//
// 구독(호스트 → 뷰어):
//   - `persona`: 페르소나 스냅샷(위젯 그리드 + 제안 질문). 전체 스냅샷이라
//     delta 병합 없이 통째로 교체(멱등, mid-join 안전).
//   - `think`: AI 사고 흐름 라인. 최근 tail 을 통째로 교체.
// 송출(뷰어 → 호스트):
//   - `inject`: 주입 필드 제출 → 호스트가 자기 주입 파이프라인을 그대로 실행 →
//     위젯 생성·가중치·think 가 persona/think 재브로드캐스트로 되돌아온다.
//
// broadcast 채널이라 sb-* 세션 없는 익명 뷰어도 송수신 가능(동시통역
// translate-viewer 패턴). read-only 불변: 유일한 write = 주입 필드.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import {
  probingPersonaSnapshotSchema,
  PROBING_PERSONA_SNAPSHOT_VERSION,
  type ProbingPersonaSnapshot,
} from '@/lib/probing-persona-snapshot';
import type { ThinkingEvent } from '@/components/canvas/widgets/probing-types';
import {
  probingLiveChannelName,
  PROBING_LIVE_PERSONA_EVENT,
  PROBING_LIVE_THINK_EVENT,
  PROBING_LIVE_INJECT_EVENT,
  probingLiveThinkSchema,
  PROBING_INJECT_QUESTION_MAX,
} from '@/lib/probing/live-channel';
import { SharePersonaCollab } from './share-persona-collab';

// 빈 스냅샷 — 초기 미저장/구 세션이어도 협업 우패널(주입 필드)을 항상 노출하기
// 위해 그리드/질문만 빈 상태로 렌더한다. live delta 가 도착하면 채워진다.
const EMPTY_SNAPSHOT: ProbingPersonaSnapshot = {
  version: PROBING_PERSONA_SNAPSHOT_VERSION,
  reflection: [],
  questions: [],
};

export function SharePersonaLive({
  sessionId,
  initialSnapshot,
  labels,
}: {
  sessionId: string;
  initialSnapshot: ProbingPersonaSnapshot | null;
  labels: {
    grid: string;
    questions: string;
    questionsEmpty: string;
    snapshotMissing: string;
    inject: string;
    thinking: string;
  };
}) {
  const [snapshot, setSnapshot] = useState<ProbingPersonaSnapshot | null>(
    initialSnapshot,
  );
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([]);
  const [thinkingStreaming, setThinkingStreaming] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // 채널 구독 — persona + think. self:true 는 뷰어 자신이 보낸 inject 를 되받는
  // 것과 무관(뷰어는 inject 를 구독하지 않음). #507 동작 유지.
  useEffect(() => {
    const supa = createBrowserSupabase();
    const ch: RealtimeChannel = supa.channel(probingLiveChannelName(sessionId), {
      config: { broadcast: { self: true } },
    });
    ch.on('broadcast', { event: PROBING_LIVE_PERSONA_EVENT }, ({ payload }) => {
      // 채널 계약(#493 스냅샷 스키마)으로 방어적 파싱 — 미지원 버전/손상 payload
      // 는 무시하고 기존 스냅샷 유지(데이터 노출 0, 크래시 0).
      const parsed = probingPersonaSnapshotSchema.safeParse(payload);
      if (parsed.success) setSnapshot(parsed.data);
    });
    ch.on('broadcast', { event: PROBING_LIVE_THINK_EVENT }, ({ payload }) => {
      const parsed = probingLiveThinkSchema.safeParse(payload);
      if (parsed.success) {
        setThinkingEvents(parsed.data.events);
        setThinkingStreaming(parsed.data.streaming);
      }
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      try {
        ch.unsubscribe();
      } catch {
        // ignore
      }
      channelRef.current = null;
    };
  }, [sessionId]);

  // 주입 필드 제출 → 호스트에 inject 송출. 채널 없거나 빈 질문이면 no-op.
  const handleInject = useCallback((question: string) => {
    const q = question.trim().slice(0, PROBING_INJECT_QUESTION_MAX);
    if (!q) return;
    channelRef.current
      ?.send({
        type: 'broadcast',
        event: PROBING_LIVE_INJECT_EVENT,
        payload: { question: q },
      })
      .catch(() => {
        // best-effort — 호스트가 못 받으면 재입력. 협업 편의 기능.
      });
  }, []);

  const view = snapshot ?? EMPTY_SNAPSHOT;
  const isEmpty =
    view.reflection.length === 0 &&
    view.questions.length === 0 &&
    thinkingEvents.length === 0;

  return (
    <div className="space-y-3">
      {isEmpty && (
        // 초기 스냅샷 미저장(구 세션) 또는 세션이 아직 페르소나를 못 채운 상태.
        // 주입 필드는 아래 협업 뷰에 그대로 노출된다(호스트가 라이브면 주입이
        // 위젯/사고 흐름을 트리거).
        <p className="text-sm text-mute-soft">{labels.snapshotMissing}</p>
      )}
      <SharePersonaCollab
        snapshot={view}
        thinkingEvents={thinkingEvents}
        thinkingStreaming={thinkingStreaming}
        onInject={handleInject}
        labels={{
          grid: labels.grid,
          questions: labels.questions,
          questionsEmpty: labels.questionsEmpty,
          inject: labels.inject,
          thinking: labels.thinking,
        }}
      />
    </div>
  );
}
