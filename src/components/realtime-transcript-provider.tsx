'use client';

/* ────────────────────────────────────────────────────────────────────
   RealtimeTranscriptProvider — canvas 위젯 간 transcript 공유.

   PR-1 인프라. translate 위젯 (host) 이 OpenAI Realtime datachannel 의
   `session.input_transcript.delta` 이벤트를 받을 때 segment 를 publish
   하면, 다른 위젯 (probing 등) 이 useRealtimeTranscript() 로 구독.

   in-memory only — 같은 브라우저 탭 안의 위젯끼리만 공유. cross-host
   (다른 브라우저/사용자) 보강은 후속 PR (Supabase Realtime broadcast).

   provider 가 mount 안 되어 있으면 publisher / consumer 모두 no-op.
   translate 가 /live 페이지에서 단독으로 돌 때 overhead 없음.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type TranscriptSegment = {
  // translate-console 의 partial line id (`input-<ts>`) 와 동일. 같은 id
  // 로 publish 되면 텍스트 갱신, 새 id 면 신규 세그먼트.
  id: string;
  // 화자 분리는 PR-1 범위 밖 — OpenAI Realtime translate 모델이
  // host/guest 구분을 못 함. 후속 모델 교체 시 채워질 자리.
  speaker?: 'host' | 'guest';
  // 누적 텍스트 (delta 들이 합쳐진).
  text: string;
  // ms epoch — 세그먼트가 처음 보인 시각.
  started_at: number;
  // ms epoch — 문장 boundary 로 finalized 된 시각. 미정 = 진행 중.
  ended_at?: number;
  // 감지된 소스 언어 (translate sourceLang).
  locale?: string;
};

export type RealtimeTranscriptApi = {
  // translate 위젯이 라이브 세션 중인지. 다른 위젯이 "통역 시작" placeholder
  // vs 실시간 표시 를 가를 때 사용.
  isLive: boolean;
  // 세션 시작 이후 누적된 세그먼트. 메모리 누수 방지를 위해 capped.
  segments: TranscriptSegment[];
  // 최근 N ms 의 세그먼트 (started_at 기준). 90_000 = 90초 미리보기.
  recent: (windowMs: number) => TranscriptSegment[];
  // 신규 세그먼트 (id 가 처음 보일 때) 콜백. 동일 id 갱신은 fire 안 함 —
  // PR-2 의 LLM 호출 트리거를 partial 갱신마다 polling 하지 않기 위함.
  subscribe: (cb: (seg: TranscriptSegment) => void) => () => void;
};

export type RealtimeTranscriptPublisher = {
  // 같은 id 면 upsert (텍스트/ended_at 갱신만), 새 id 면 push + subscribers.
  publishSegment: (seg: TranscriptSegment) => void;
  setLive: (live: boolean) => void;
  // 새 세션 시작 시 호출. segments 비우고 isLive 초기화는 setLive 가 따로.
  clear: () => void;
};

// 누적 세그먼트 cap. 한 인터뷰 60분 × ~15 utt/min ≈ 900. 1000 까지 허용 —
// 초과 시 가장 오래된 segment 부터 drop.
const SEGMENT_CAP = 1000;

const ConsumerCtx = createContext<RealtimeTranscriptApi | null>(null);
const PublisherCtx = createContext<RealtimeTranscriptPublisher | null>(null);

// publisher / consumer 가 같은 provider 를 공유하지만 React context 는
// 둘로 나눈다 — translate-console 은 publisher 만, probing-card 는 consumer
// 만 다시 렌더. consumer 측 segments 가 자주 바뀌어도 publisher 호출부는
// re-render 안 됨.
export function RealtimeTranscriptProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLive, setIsLive] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  // subscribers 는 ref — set 갱신이 publisher 재생성을 트리거하지 않도록.
  const subscribersRef = useRef(new Set<(seg: TranscriptSegment) => void>());
  // 이미 publish 된 id 추적. partial 갱신 vs 신규 세그먼트 구분에 사용.
  const knownIdsRef = useRef(new Set<string>());

  const publishSegment = useCallback((seg: TranscriptSegment) => {
    const isNew = !knownIdsRef.current.has(seg.id);
    if (isNew) knownIdsRef.current.add(seg.id);

    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === seg.id);
      if (idx === -1) {
        const next = [...prev, seg];
        // cap — 가장 오래된 segment 부터 drop. id set 도 같이 정리.
        if (next.length > SEGMENT_CAP) {
          const dropped = next.splice(0, next.length - SEGMENT_CAP);
          for (const d of dropped) knownIdsRef.current.delete(d.id);
        }
        return next;
      }
      const copy = prev.slice();
      copy[idx] = seg;
      return copy;
    });

    if (isNew) {
      // subscriber 가 throw 해도 다른 subscriber 들은 계속 통지.
      for (const cb of subscribersRef.current) {
        try {
          cb(seg);
        } catch (e) {
          console.error('[realtime-transcript] subscriber error', e);
        }
      }
    }
  }, []);

  const setLive = useCallback((live: boolean) => {
    setIsLive(live);
  }, []);

  const clear = useCallback(() => {
    knownIdsRef.current.clear();
    setSegments([]);
  }, []);

  const recent = useCallback(
    (windowMs: number) => {
      const cutoff = Date.now() - windowMs;
      return segments.filter((s) => s.started_at >= cutoff);
    },
    [segments],
  );

  const subscribe = useCallback((cb: (seg: TranscriptSegment) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const consumerValue = useMemo<RealtimeTranscriptApi>(
    () => ({ isLive, segments, recent, subscribe }),
    [isLive, segments, recent, subscribe],
  );

  const publisherValue = useMemo<RealtimeTranscriptPublisher>(
    () => ({ publishSegment, setLive, clear }),
    [publishSegment, setLive, clear],
  );

  return (
    <PublisherCtx.Provider value={publisherValue}>
      <ConsumerCtx.Provider value={consumerValue}>
        {children}
      </ConsumerCtx.Provider>
    </PublisherCtx.Provider>
  );
}

// 소비자 hook — provider 가 없으면 빈 stub 반환 (no-op). canvas 밖의
// translate-console (/live) 가 import 해도 안전.
const EMPTY_SEGMENTS: TranscriptSegment[] = [];
const EMPTY_API: RealtimeTranscriptApi = {
  isLive: false,
  segments: EMPTY_SEGMENTS,
  recent: () => EMPTY_SEGMENTS,
  subscribe: () => () => {},
};

export function useRealtimeTranscript(): RealtimeTranscriptApi {
  return useContext(ConsumerCtx) ?? EMPTY_API;
}

// 발행자 hook — translate-console 이 사용. provider 없으면 publish/setLive
// 호출이 no-op 이라 다른 컨텍스트 (/live 페이지) 에서도 동일 코드가 동작.
const NOOP_PUBLISHER: RealtimeTranscriptPublisher = {
  publishSegment: () => {},
  setLive: () => {},
  clear: () => {},
};

export function useRealtimeTranscriptPublisher(): RealtimeTranscriptPublisher {
  return useContext(PublisherCtx) ?? NOOP_PUBLISHER;
}

// translate-console 처럼 status 가 바뀔 때 setLive 를 wire 하는 헬퍼.
// unmount 시 자동 false 처리 — provider 가 mount 되어 있는 동안만 의미.
export function useRealtimeTranscriptLiveBinding(live: boolean) {
  const { setLive } = useRealtimeTranscriptPublisher();
  useEffect(() => {
    setLive(live);
    return () => {
      setLive(false);
    };
  }, [live, setLive]);
}
