'use client';

// 공유 뷰어 프로빙 페르소나 — 초기 스냅샷(#493) 위에 실시간 broadcast 를 얹는
// read-only 라이브 래퍼(probing-persona-share-live-broadcast).
//
// 초기 = 서버가 넘긴 #493 스냅샷(mid-join 즉시 표시). 그 위에
// probing-live:<sessionId> broadcast 채널을 구독해 호스트의 페르소나 갱신마다
// 그리드/질문을 live 재렌더한다. broadcast 채널이라 sb-* 세션 없는 익명 뷰어도
// 수신 가능(동시통역 translate-viewer.tsx:212 구독 패턴 이식 — postgres_changes
// 아님).
//
// read-only 불변: SharePersonaView 는 순수 표시 컴포넌트라 편집/드래그/생성
// 액션 props 자체가 없다(결정 2). 여기서도 상태를 setSnapshot 으로만 갱신하고
// 어떤 mutation 진입점도 노출하지 않는다.

import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import {
  probingPersonaSnapshotSchema,
  type ProbingPersonaSnapshot,
} from '@/lib/probing-persona-snapshot';
import {
  probingLiveChannelName,
  PROBING_LIVE_PERSONA_EVENT,
} from '@/lib/probing/live-channel';
import { SharePersonaView } from './share-persona-view';

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
  };
}) {
  const [snapshot, setSnapshot] = useState<ProbingPersonaSnapshot | null>(
    initialSnapshot,
  );

  // probing-live:<sessionId> broadcast 구독. 호스트가 persona 갱신마다 전체
  // 스냅샷을 보내므로 delta 병합 없이 통째로 교체한다(멱등, 순서 뒤섞임 무해).
  useEffect(() => {
    const supa = createBrowserSupabase();
    let ch: RealtimeChannel | null = supa.channel(
      probingLiveChannelName(sessionId),
      { config: { broadcast: { self: true } } },
    );
    ch.on('broadcast', { event: PROBING_LIVE_PERSONA_EVENT }, ({ payload }) => {
      // 채널 계약(#493 스냅샷 스키마) 으로 방어적 파싱 — 미지원 버전/손상
      // payload 는 무시하고 기존 스냅샷 유지(데이터 노출 0, 크래시 0).
      // translate-viewer 의 방어적 gate 미러.
      const parsed = probingPersonaSnapshotSchema.safeParse(payload);
      if (parsed.success) setSnapshot(parsed.data);
    });
    // 채널 끊김 후 supabase-js 가 자동 재연결/재구독한다(재연결 시 호스트의
    // 다음 tick 이 최신 전체 스냅샷을 다시 보내므로 별도 backfill 불필요).
    ch.subscribe();
    return () => {
      try {
        ch?.unsubscribe();
      } catch {
        // ignore
      }
      ch = null;
    };
  }, [sessionId]);

  if (
    !snapshot ||
    (snapshot.reflection.length === 0 && snapshot.questions.length === 0)
  ) {
    // 초기 스냅샷 미저장(구 세션) 또는 세션이 아직 페르소나를 못 채운 상태.
    // live delta 가 도착하면 위 setSnapshot 이 콘텐츠 뷰로 전환한다.
    return <p className="text-md text-mute">{labels.snapshotMissing}</p>;
  }

  return (
    <SharePersonaView
      snapshot={snapshot}
      labels={{
        grid: labels.grid,
        questions: labels.questions,
        questionsEmpty: labels.questionsEmpty,
      }}
    />
  );
}
