'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FeatureKey } from '@/lib/features';
import { FEATURE_COSTS } from '@/lib/features';
import { useCreditDeduction } from '@/components/credit-deduction-provider';

// A lightweight client-side job tracker for feature generators that talk
// to one-shot APIs (POST → wait → JSON). Lives at the layout level so an
// in-flight fetch survives navigation between sidebar pages — the
// component can unmount, and when the user comes back they see the same
// running/done/error state read from this context.
//
// This is *not* a durable backend job queue (transcripts and interviews
// already have their own DB-backed providers for that). A full page
// refresh still drops in-flight work. If a feature needs cross-refresh
// durability, model it like /api/transcripts/jobs instead.

export type JobStatus = 'idle' | 'running' | 'done' | 'error';

export type GenerationJobProgress = {
  /** 0–100, capped at 99 while still running so the sidebar never shows
   *  100% before the job actually transitions to `done`. */
  percent?: number;
  /** Free-form phase identifier used as an i18n key
   *  (e.g. `'normalizing'`, `'generating'`). */
  phase?: string;
};

export type GenerationJob = {
  status: JobStatus;
  startedAt: number | null;
  doneAt: number | null;
  input: unknown;
  result: unknown;
  error: string | null;
  runId: string;
  progress: GenerationJobProgress;
};

const IDLE: GenerationJob = {
  status: 'idle',
  startedAt: null,
  doneAt: null,
  input: null,
  result: null,
  error: null,
  runId: '',
  progress: {},
};

type StartOptions<T> = {
  input?: unknown;
  run: () => Promise<T>;
};

type Ctx = {
  jobs: Partial<Record<FeatureKey, GenerationJob>>;
  get: (key: FeatureKey) => GenerationJob;
  isWorking: (key: FeatureKey) => boolean;
  start: <T>(key: FeatureKey, opts: StartOptions<T>) => Promise<T | null>;
  /** Update the in-flight job's progress. No-op if the feature has no
   *  running job. Callers typically invoke this from inside their `run`
   *  callback at phase boundaries. */
  setProgress: (key: FeatureKey, progress: GenerationJobProgress) => void;
  reset: (key: FeatureKey) => void;
};

const GenerationJobsCtx = createContext<Ctx | null>(null);

function makeRunId() {
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function GenerationJobProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<Partial<Record<FeatureKey, GenerationJob>>>(
    {},
  );
  // 차감 broadcast — start() 가 성공으로 resolve 될 때 한 번 자동 emit.
  // 서버 응답이 deducted/balance 를 돌려주지 않는 endpoint 도 카탈로그
  // cost 로 fly-up 을 띄울 수 있게 한다. 응답 body 형식 통일 후엔 그 값으로
  // override 가능 (별 spec).
  const { notify } = useCreditDeduction();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const get = useCallback<Ctx['get']>(
    (key) => jobs[key] ?? IDLE,
    [jobs],
  );

  const isWorking = useCallback<Ctx['isWorking']>(
    (key) => (jobs[key]?.status ?? 'idle') === 'running',
    [jobs],
  );

  const start = useCallback(async function start<T>(
    key: FeatureKey,
    opts: StartOptions<T>,
  ): Promise<T | null> {
    const runId = makeRunId();
    setJobs((prev) => ({
      ...prev,
      [key]: {
        status: 'running',
        startedAt: Date.now(),
        doneAt: null,
        input: opts.input ?? null,
        result: null,
        error: null,
        runId,
        progress: {},
      },
    }));
    try {
      const result = await opts.run();
      setJobs((prev) => {
        const cur = prev[key];
        // If a newer run started while we were awaiting, don't clobber it.
        if (cur && cur.runId !== runId) return prev;
        return {
          ...prev,
          [key]: {
            status: 'done',
            startedAt: cur?.startedAt ?? Date.now(),
            doneAt: Date.now(),
            input: opts.input ?? null,
            result,
            error: null,
            runId,
            progress: {},
          },
        };
      });
      // 성공 차감 신호 — 위젯 헤더 fly-up + topbar pulse 트리거.
      // amount 는 카탈로그 cost (FEATURE_COSTS) — 동적 가격 feature 는
      // 호출처에서 별도 notify(feature, actualAmount) 로 정확 amount 를
      // 다시 emit 할 수 있음.
      const flat = FEATURE_COSTS[key];
      if (typeof flat === 'number' && flat > 0) {
        notifyRef.current(key, flat);
      }
      return result;
    } catch (e) {
      setJobs((prev) => {
        const cur = prev[key];
        if (cur && cur.runId !== runId) return prev;
        return {
          ...prev,
          [key]: {
            status: 'error',
            startedAt: cur?.startedAt ?? Date.now(),
            doneAt: Date.now(),
            input: opts.input ?? null,
            result: null,
            error: e instanceof Error ? e.message : 'unknown_error',
            runId,
            progress: {},
          },
        };
      });
      return null;
    }
  }, []);

  const setProgress = useCallback<Ctx['setProgress']>((key, progress) => {
    setJobs((prev) => {
      const cur = prev[key];
      if (!cur || cur.status !== 'running') return prev;
      // Clamp to 0–99 — 100 is reserved for status flip to `done`.
      const clamped: GenerationJobProgress = {
        ...progress,
        percent:
          typeof progress.percent === 'number'
            ? Math.max(0, Math.min(99, Math.round(progress.percent)))
            : progress.percent,
      };
      return {
        ...prev,
        [key]: { ...cur, progress: clamped },
      };
    });
  }, []);

  const reset = useCallback<Ctx['reset']>((key) => {
    setJobs((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ jobs, get, isWorking, start, setProgress, reset }),
    [jobs, get, isWorking, start, setProgress, reset],
  );

  return (
    <GenerationJobsCtx.Provider value={value}>
      {children}
    </GenerationJobsCtx.Provider>
  );
}

export function useGenerationJobs() {
  const ctx = useContext(GenerationJobsCtx);
  if (!ctx)
    throw new Error('useGenerationJobs must be used inside <GenerationJobProvider>');
  return ctx;
}
