'use client';

/* ────────────────────────────────────────────────────────────────────
   useUtInsightClips — AI UT 인사이트 클립(card 626) 클라 엔진.

   서버 파이프라인은 상태 머신(indexing → searching → analyzing → reporting →
   done | error)이고, 각 POST 가 **한 단계** 를 전진시킨다(video/jobs/poll 패턴).
   이 훅은 trigger() 로 시작한 뒤 terminal(done/error)까지 POST 를 반복해
   진행 상태·클립·리포트를 갱신한다. 상태 read 는 GET(초기 로드/재마운트).

   느린 단계(Pegasus 분석)는 POST 자체가 길게 블록되므로 await 로 자연 조율.
   indexing 은 서버가 즉시 'indexing' 을 돌려주니 클라가 간격을 두고 재시도.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';

export type InsightClipView = {
  id: string;
  start_ms: number;
  end_ms: number;
  theme: string | null;
  transcript_span: string | null;
  relevance: number | null;
  insight: {
    summary?: string;
    quote?: string;
    friction?: string;
    emotion?: string;
    severity?: 'low' | 'medium' | 'high';
    source?: string;
  } | null;
  has_clip: boolean;
};

export type InsightSummary = {
  overview?: string;
  key_themes?: Array<{ theme: string; detail: string }>;
  top_frictions?: Array<{ title: string; detail: string; clip_index: number | null }>;
  notable_quotes?: Array<{ quote: string; clip_index: number | null }>;
  task_outcome?: string;
  generated_at?: string;
};

export type InsightState = {
  status: string; // idle | indexing | searching | analyzing | reporting | done | error
  error: string | null;
  summary: InsightSummary | null;
  clips: InsightClipView[];
};

const MAX_STEPS = 120;

function delayFor(status: string): number {
  // Indexing returns fast from the server but TL is still working — space out
  // the retries. Other steps block inside the POST, so a short gap is enough.
  return status === 'indexing' ? 5000 : 1200;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTerminal(status: string): boolean {
  return status === 'done' || status === 'error';
}

export function useUtInsightClips(
  sessionId: string | null,
  locale: string,
  autoStart = false,
) {
  const [state, setState] = useState<InsightState | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);
  // Guards the mount-time auto-start so a re-render / refetch never re-kicks the
  // pipeline (each POST costs a TwelveLabs/Pegasus step — double-charge risk).
  const autoStartedRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const advance = useCallback(async (): Promise<InsightState | null> => {
    if (!sessionId) return null;
    const res = await fetchWithAuth(`/api/ut/sessions/${sessionId}/insight-clips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
    if (!res.ok) throw new Error(`insight_${res.status}`);
    return (await res.json()) as InsightState;
  }, [sessionId, locale]);

  const trigger = useCallback(async () => {
    if (!sessionId || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        if (!aliveRef.current) break;
        let next: InsightState | null;
        try {
          next = await advance();
        } catch {
          // transient — retry a couple times then give the UI back.
          await sleep(2000);
          continue;
        }
        if (next && aliveRef.current) setState(next);
        if (!next) break;
        if (isTerminal(next.status)) break;
        await sleep(delayFor(next.status));
      }
    } finally {
      runningRef.current = false;
      if (aliveRef.current) setRunning(false);
    }
  }, [sessionId, advance]);

  // Initial read (no advance) so a re-opened session shows an existing report.
  // When autoStart is on, kick the pipeline exactly once based on the *server*
  // status (SSOT): idle → start, a mid-run status (indexing…reporting) → resume
  // driving it to terminal. Never auto-run a done report (nothing to do) or
  // auto-retry an error (avoid burning quota on repeated failures — that stays
  // a manual "try again"). trigger()'s runningRef also blocks concurrent kicks.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/ut/sessions/${sessionId}/insight-clips`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as InsightState;
        if (cancelled) return;
        setState(j);
        if (autoStart && !autoStartedRef.current && !isTerminal(j.status)) {
          autoStartedRef.current = true;
          void trigger();
        }
      } catch {
        /* ignore — trigger() surfaces errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, autoStart, trigger]);

  return { state, running, trigger };
}
