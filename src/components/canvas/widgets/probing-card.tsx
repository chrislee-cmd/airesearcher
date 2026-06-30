'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   PR (probing-question-thinking-flow): 우패널을 4-layer 로 재편 —
     A. 사용자 입력 (조사 목적 / 핵심 가설 / KRQ) — DB 영속화
     B. AI self-thinking 스트리밍 — `/api/probing/think` 의 NDJSON 라인
     C. 비주기적 질문 popup (15s 자동 dismiss + importance visual)
     D. 누적 history 패널 (핀 / 복사 / 삭제)

   좌패널 (페르소나 8 패널) 은 그대로. 좌/우는 독립 agent — transcript
   변경 → debounce 5초 → 좌·우 호출. 좌패널은 응답자 페르소나, 우패널은
   THINK + EMIT 라인 스트림 + popup queue.

   기존 단일 질문 list UI / `/api/probing/suggest` 호출 / "지금 제안"
   수동 trigger 는 폐기. emit 한 질문은 DB (`probing_questions`) 에
   계속 기록되어 account-export 가 그대로 동작 — 단 위젯 UI 는 in-memory
   history 만 표시 (페르소나처럼 휘발).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import {
  useRealtimeTranscription,
  type TranscriptionSegment,
} from '@/hooks/use-realtime-transcription';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import { triggerBlobDownload } from '@/lib/export/download';
import {
  generatePersonaDocx,
  buildPersonaFilename,
  collectTranscriptQuotes,
} from '@/lib/probing-persona-docx';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { WidgetSubHeader } from '@/components/canvas/shell/widget-subheader';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import type {
  HistoryQuestion,
  PopupQuestion,
  ResearchContext,
} from './probing-types';
import {
  type ProbingReflectionData,
  type ReflectionStatus,
} from './probing/reflection-pane';
import { ProbingCanvasCardBody } from './probing/canvas-card-body';
import { ProbingFullView } from './probing/full-view';
import {
  PROBING_PERSONA_SECTION_KEYS,
  PROBING_TECHNIQUES,
  PROBING_THINK_IMPORTANCE,
  probingThinkEmitSchema,
  type ProbingOutputLang,
  type ProbingPersonaSection,
  type ProbingPersonaSectionKey,
} from '@/lib/probing-prompts';

// 좌패널 reflection 이 모델에 보낼 누적 transcript 상한.
const REFLECTION_MAX_CHARS = 60_000;
// 우패널 think 가 보낼 transcript 상한.
const THINK_MAX_CHARS = 60_000;
// transcript 60자 미만이면 좌/우 자동 호출 모두 skip.
const MIN_TRANSCRIPT_CHARS = 60;
// transcript 변경 → 자동 호출 debounce.
const DEBOUNCE_MS = 5_000;
// history 보관 cap. 너무 오래 누적되면 메모리 / 표시 부담.
const HISTORY_MAX = 100;

// transcript 가 멈춰 있을 때도 popup 카운트다운 / history 시간 표시가 흐르도록
// 1초마다 강제 리렌더.
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function segmentsText(segments: TranscriptionSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n');
}

// 좌패널 페르소나 → 우패널 think prompt 에 직접 안 들어감 (think 는 사용자
// 입력 + transcript 만 보고 사고). 별 helper 불필요.

type SourceKind = 'mic' | 'tab';

function SourcePicker({
  value,
  onChange,
  disabled,
}: {
  value: SourceKind;
  onChange: (next: SourceKind) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm text-mute">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SourceKind)}
        disabled={disabled}
        aria-label="입력 소스"
        className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink"
      >
        <option value="mic">마이크</option>
        <option value="tab">탭 오디오</option>
      </select>
    </div>
  );
}

// 분석 출력 언어 옵션 — translate 의 LANGS 6종과 동일. 입력 (STT) 언어와
// 독립적으로 분석 결과 언어를 선택 (예: 한국어 인터뷰 → 영어 분석).
const OUTPUT_LANG_OPTIONS: { value: ProbingOutputLang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
];

function OutputLangPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProbingOutputLang;
  onChange: (next: ProbingOutputLang) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm text-mute">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProbingOutputLang)}
        disabled={disabled}
        aria-label="분석 출력 언어"
        className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink"
      >
        {OUTPUT_LANG_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// 검증 helper — think route 의 EMIT 라인 JSON 을 schema 로 통과시킨다.
function parseEmit(raw: string): PopupQuestion | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = probingThinkEmitSchema.safeParse(parsed);
    if (!result.success) return null;
    const { text, technique, rationale, importance } = result.data;
    const id = `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      text,
      technique,
      rationale,
      importance,
      emitted_at: Date.now(),
    };
  } catch {
    return null;
  }
}

function ExpandedBody() {
  const toast = useToast();
  const now = useNowTick();

  const {
    status: sessionStatus,
    segments: rawSegments,
    error: sessionError,
    start: startSession,
    stop: stopSession,
  } = useRealtimeTranscription({ locale: 'ko' });

  const [source, setSource] = useState<SourceKind>('mic');

  // 분석 출력 언어 — 입력 (STT locale 'ko') 와 독립. 세션마다 새로 선택
  // (영속화 X). default ko = 옛 동작 (한국어 분석). think / reflection 자동
  // 호출은 useCallback 안에서 ref 로 최신 값을 읽는다 (deps 재생성 회피).
  const [outputLang, setOutputLang] = useState<ProbingOutputLang>('ko');
  const outputLangRef = useRef(outputLang);
  useEffect(() => {
    outputLangRef.current = outputLang;
  }, [outputLang]);

  // 전체보기 — 공유 모달(CanvasBoard FullviewShell)이 소유. probing 이
  // currentKey 일 때만 본문(ProbingFullView)을 모달 slot 으로 portal 한다.
  // 카드(ExpandedBody)는 모달이 열려 있어도 항상 마운트되므로
  // useRealtimeTranscription 세션이 위젯 swap·모달 close 후에도 보존된다
  // (옛 위젯별 모달 + provider hoist 불필요).
  const { isCurrent, renderInSlot, close } = useFullview('probing');

  const isLive = sessionStatus === 'live';

  const { setState: setWidgetState } = useWidgetState();
  useEffect(() => {
    if (sessionStatus === 'starting') {
      setWidgetState({ kind: 'running', label: 'CONNECTING' });
      return;
    }
    if (sessionStatus === 'live') {
      setWidgetState({ kind: 'running', label: 'LIVE' });
      return;
    }
    if (sessionStatus === 'stopping') {
      setWidgetState({ kind: 'running', label: 'STOPPING' });
      return;
    }
    if (sessionStatus === 'error') {
      setWidgetState({ kind: 'error', message: sessionError ?? undefined });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [setWidgetState, sessionStatus, sessionError]);

  // ─── 우패널 입력 — research_context (DB upsert) ───
  const [context, setContext] = useState<ResearchContext>({
    research_goal: '',
    hypotheses: [],
    key_research_question: '',
  });
  const [contextHydrated, setContextHydrated] = useState(false);
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // mount 시 1회 — 마지막으로 저장한 컨텍스트 hydrate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/probing/research-context', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
        const j = (await res.json()) as {
          row?: {
            research_goal?: string;
            hypotheses?: string[];
            key_research_question?: string;
          };
        };
        if (cancelled) return;
        if (j.row) {
          setContext({
            research_goal: j.row.research_goal ?? '',
            hypotheses: Array.isArray(j.row.hypotheses)
              ? j.row.hypotheses.filter((h) => typeof h === 'string')
              : [],
            key_research_question: j.row.key_research_question ?? '',
          });
        }
      } catch {
        // hydration 실패 — 빈 컨텍스트로 시작.
      } finally {
        if (!cancelled) setContextHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // context 변경 시 debounced PUT.
  useEffect(() => {
    if (!contextHydrated) return;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          await fetch('/api/probing/research-context', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              research_goal: contextRef.current.research_goal,
              hypotheses: contextRef.current.hypotheses,
              key_research_question:
                contextRef.current.key_research_question,
            }),
          });
        } catch {
          // best-effort. 사용자에게 토스트는 부담스러우니 silent.
        }
      })();
    }, 800);
    return () => clearTimeout(handle);
  }, [context, contextHydrated]);

  // ─── 좌패널 — Reflection state ───
  const [reflection, setReflection] = useState<ProbingReflectionData | null>(
    null,
  );
  const [reflectionStatus, setReflectionStatus] =
    useState<ReflectionStatus>('idle');
  const [reflectionLastUpdatedAt, setReflectionLastUpdatedAt] = useState<
    number | null
  >(null);
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const reflectionInFlightRef = useRef(false);
  const reflectionRef = useRef<ProbingReflectionData | null>(null);
  useEffect(() => {
    reflectionRef.current = reflection;
  }, [reflection]);

  // ─── 우패널 — think stream + popup queue + history ───
  const [thinkingEvents, setThinkingEvents] = useState<
    Array<{ id: string; at: number; text: string }>
  >([]);
  const [thinkingStreaming, setThinkingStreaming] = useState(false);
  const [thinkingError, setThinkingError] = useState<string | null>(null);
  const thinkInFlightRef = useRef(false);
  const thinkAbortRef = useRef<AbortController | null>(null);

  const [activePopup, setActivePopup] = useState<PopupQuestion | null>(null);
  const [history, setHistory] = useState<HistoryQuestion[]>([]);

  // ─── 페르소나 export — 세션 시작 시점 추적 + confirm modal + busy flag ───
  // sessionStartedAt: 라이브 진입 시 한 번 set, 종료 시 docx 메타 (인터뷰 일시 /
  // 인터뷰 길이) 로 사용. 새 세션 시작 시 리셋.
  const sessionStartedAtRef = useRef<Date | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // popup → history 로 옮기는 helper. 중복 push 방지 위해 set 자리 있던 popup
  // 만 옮긴다. dismissed_reason 으로 origin 분류.
  const pushHistoryFromPopup = useCallback(
    (popup: PopupQuestion, reason: HistoryQuestion['dismissed_reason']) => {
      setHistory((prev) => {
        if (prev.some((p) => p.id === popup.id)) return prev;
        const next: HistoryQuestion = {
          ...popup,
          is_starred: reason === 'pin',
          dismissed_reason: reason,
          dismissed_at: Date.now(),
        };
        return [next, ...prev].slice(0, HISTORY_MAX);
      });
    },
    [],
  );

  const persistEmittedQuestion = useCallback(
    async (popup: PopupQuestion) => {
      // probing_questions DB 에 백그라운드 기록 — account-export 가 그대로
      // 동작하도록. 실패는 무시 (위젯 UX 에 영향 X).
      try {
        await fetch('/api/probing/questions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: popup.text,
            technique: popup.technique,
            why: popup.rationale,
          }),
        });
      } catch {
        // silent
      }
    },
    [],
  );

  // 새 emit 도착 → popup 큐 처리. 기존 popup 살아 있으면 즉시 history 로 push
  // ('replaced') + 새 popup 표시. 스펙 명시: "새거 즉시 표시 + 옛것 history".
  const handleEmit = useCallback(
    (popup: PopupQuestion) => {
      setActivePopup((current) => {
        if (current) {
          pushHistoryFromPopup(current, 'replaced');
        }
        return popup;
      });
      void persistEmittedQuestion(popup);
    },
    [pushHistoryFromPopup, persistEmittedQuestion],
  );

  // 누적 segments — 좌/우 모두 누적 transcript 를 본다.
  const hasTranscript = rawSegments.length > 0;
  const rawSegmentsRef = useRef(rawSegments);
  useEffect(() => {
    rawSegmentsRef.current = rawSegments;
  }, [rawSegments]);

  const cumulativeChars = useMemo(
    () => rawSegments.reduce((sum, s) => sum + s.text.trim().length, 0),
    [rawSegments],
  );

  // ─── think route SSE consumer ───
  const runThink = useCallback(async () => {
    if (thinkInFlightRef.current) return;
    const segs = rawSegmentsRef.current;
    const fullText = segmentsText(segs);
    if (fullText.length < MIN_TRANSCRIPT_CHARS) return;
    const transcript =
      fullText.length > THINK_MAX_CHARS
        ? fullText.slice(fullText.length - THINK_MAX_CHARS)
        : fullText;

    thinkInFlightRef.current = true;
    setThinkingStreaming(true);
    setThinkingError(null);
    const controller = new AbortController();
    thinkAbortRef.current = controller;

    try {
      const res = await fetch('/api/probing/think', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: transcript,
          research_goal: contextRef.current.research_goal,
          hypotheses: contextRef.current.hypotheses,
          key_research_question: contextRef.current.key_research_question,
          output_lang: outputLangRef.current,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `think_failed_${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 줄 단위 dispatch. THINK / EMIT prefix 외 라인은 무시 (LLM 이 룰 위반
      // 시 silent drop — UX 영향 0).
      const dispatchLine = (line: string) => {
        if (line.startsWith('THINK:')) {
          const text = line.slice('THINK:'.length).trim();
          if (text.length === 0) return;
          setThinkingEvents((prev) => [
            ...prev,
            {
              id: `think_${Date.now()}_${prev.length}_${Math.random().toString(36).slice(2, 6)}`,
              at: Date.now(),
              text,
            },
          ]);
        } else if (line.startsWith('EMIT:')) {
          const raw = line.slice('EMIT:'.length).trim();
          const popup = parseEmit(raw);
          if (popup) handleEmit(popup);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx = buffer.indexOf('\n');
        while (nlIdx !== -1) {
          const line = buffer.slice(0, nlIdx).trimEnd();
          buffer = buffer.slice(nlIdx + 1);
          if (line.length > 0) dispatchLine(line);
          nlIdx = buffer.indexOf('\n');
        }
      }
      // 마지막 잔여 라인.
      const tail = buffer.trim();
      if (tail.length > 0) dispatchLine(tail);
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : 'think_failed';
      setThinkingError(msg);
      toast.push('AI 사고 흐름 실패 — 잠시 후 다시 시도해 주세요', {
        tone: 'warn',
      });
    } finally {
      thinkInFlightRef.current = false;
      thinkAbortRef.current = null;
      setThinkingStreaming(false);
    }
  }, [toast, handleEmit]);

  const runThinkRef = useRef(runThink);
  useEffect(() => {
    runThinkRef.current = runThink;
  }, [runThink]);

  // ─── 좌패널 — Reflection Agent (응답자 페르소나) ───
  const runReflection = useCallback(async () => {
    if (reflectionInFlightRef.current) return;
    const segs = rawSegmentsRef.current;
    const fullText = segmentsText(segs);
    if (fullText.length < MIN_TRANSCRIPT_CHARS) return;
    const trimmed =
      fullText.length > REFLECTION_MAX_CHARS
        ? fullText.slice(fullText.length - REFLECTION_MAX_CHARS)
        : fullText;

    reflectionInFlightRef.current = true;
    setReflectionStatus('streaming');
    setReflectionError(null);

    try {
      const res = await fetch('/api/probing/reflection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: trimmed,
          interview_guide: '',
          output_lang: outputLangRef.current,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `reflection_failed_${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const parsed = await parsePartialJson(buffer);
      const obj = (parsed.value ?? null) as Record<string, unknown> | null;
      if (obj && typeof obj === 'object') {
        const prev = reflectionRef.current;
        const merged: ProbingReflectionData = { ...(prev ?? {}) };
        let anyChange = false;
        for (const key of PROBING_PERSONA_SECTION_KEYS) {
          const sec = obj[key] as Record<string, unknown> | undefined;
          if (!sec || typeof sec !== 'object') continue;
          const summary = typeof sec.summary === 'string' ? sec.summary : '';
          const signalsRaw = Array.isArray(sec.signals) ? sec.signals : [];
          const signals = signalsRaw
            .filter(
              (s): s is Record<string, unknown> =>
                !!s && typeof s === 'object',
            )
            .map((s) => ({
              bullet: typeof s.bullet === 'string' ? s.bullet : '',
              quote: typeof s.quote === 'string' ? s.quote : undefined,
            }))
            .filter((s) => s.bullet.trim().length > 0);
          const confidenceRaw = sec.confidence;
          const confidence: ProbingPersonaSection['confidence'] =
            confidenceRaw === 'high' ||
            confidenceRaw === 'medium' ||
            confidenceRaw === 'low'
              ? confidenceRaw
              : 'insufficient';
          const hasContent = summary.trim().length > 0 || signals.length > 0;
          if (hasContent) {
            merged[key] = { summary, signals, confidence };
            anyChange = true;
          } else if (!merged[key]) {
            merged[key] = { summary, signals, confidence };
            anyChange = true;
          }
        }
        const hasAnyKey = (Object.keys(merged) as ProbingPersonaSectionKey[])
          .some((k) => merged[k] !== undefined);
        if (anyChange || (prev === null && hasAnyKey)) {
          setReflection(merged);
          setReflectionLastUpdatedAt(Date.now());
          setReflectionStatus('ready');
          return;
        }
      }
      throw new Error('empty_reflection');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'reflection_failed';
      setReflectionError(msg);
      setReflectionStatus('error');
      toast.push('페르소나 생성 실패 — 잠시 후 다시 시도해 주세요', {
        tone: 'warn',
      });
    } finally {
      reflectionInFlightRef.current = false;
    }
  }, [toast]);

  const runReflectionRef = useRef(runReflection);
  useEffect(() => {
    runReflectionRef.current = runReflection;
  }, [runReflection]);

  // ─── 자동 트리거: transcript 변경 → 5초 debounce → 좌·우 호출 ───
  useEffect(() => {
    if (!isLive) return;
    if (cumulativeChars < MIN_TRANSCRIPT_CHARS) return;
    const id = setTimeout(() => {
      void runReflectionRef.current();
      void runThinkRef.current();
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawSegments, cumulativeChars, isLive]);

  // 새 세션 시작 → in-memory 상태 리셋 (research_context 는 DB 라 유지).
  const prevLiveRef = useRef(false);
  useEffect(() => {
    const prev = prevLiveRef.current;
    if (!prev && isLive) {
      sessionStartedAtRef.current = new Date();
      setReflection(null);
      setReflectionStatus('idle');
      setReflectionLastUpdatedAt(null);
      setReflectionError(null);
      setThinkingEvents([]);
      setThinkingError(null);
      setActivePopup(null);
      setHistory([]);
    }
    prevLiveRef.current = isLive;
  }, [isLive]);

  // 세션 stop 시 진행 중 think SSE abort.
  useEffect(() => {
    if (sessionStatus === 'idle' || sessionStatus === 'stopping') {
      thinkAbortRef.current?.abort();
    }
  }, [sessionStatus]);

  // 수동 좌패널 갱신 / 우패널 think.
  const handleManualReflection = useCallback(() => {
    void runReflectionRef.current();
  }, []);
  const handleManualThink = useCallback(() => {
    void runThinkRef.current();
  }, []);

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push('복사됨', { tone: 'info', ttlMs: 1800 });
    } catch {
      toast.push('복사 실패 — 직접 선택해서 복사해 주세요', { tone: 'warn' });
    }
  }

  // popup 액션.
  const handlePopupAutoDismiss = useCallback(() => {
    setActivePopup((cur) => {
      if (cur) pushHistoryFromPopup(cur, 'auto');
      return null;
    });
  }, [pushHistoryFromPopup]);
  const handlePopupManualDismiss = useCallback(() => {
    setActivePopup((cur) => {
      if (cur) pushHistoryFromPopup(cur, 'manual');
      return null;
    });
  }, [pushHistoryFromPopup]);
  const handlePopupPin = useCallback(() => {
    setActivePopup((cur) => {
      if (cur) pushHistoryFromPopup(cur, 'pin');
      return null;
    });
    toast.push('★ history 에 핀했어요', { tone: 'info', ttlMs: 1500 });
  }, [pushHistoryFromPopup, toast]);
  const handlePopupCopy = useCallback(() => {
    if (!activePopup) return;
    void handleCopy(activePopup.text);
    // copy 는 popup 을 dismiss 하지 않음 — 사용자가 던질 시간 보존.
  }, [activePopup, toast]); // eslint-disable-line react-hooks/exhaustive-deps -- handleCopy 는 매 렌더 재생성되지만 본문이 stable 한 함수라 OK.

  // history 액션.
  const handleHistoryCopy = useCallback(
    (text: string) => {
      void handleCopy(text);
    },
    [toast], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const handleHistoryToggleStar = useCallback((id: string) => {
    setHistory((prev) =>
      prev.map((q) => (q.id === id ? { ...q, is_starred: !q.is_starred } : q)),
    );
  }, []);
  const handleHistoryDelete = useCallback((id: string) => {
    setHistory((prev) => prev.filter((q) => q.id !== id));
  }, []);

  // 세션 시작 / 정지.
  const handleStartSession = useCallback(async () => {
    await startSession({ source });
  }, [startSession, source]);
  const handleStopSession = useCallback(async () => {
    await stopSession();
  }, [stopSession]);

  // ─── 페르소나 export ──────────────────────────────────────────────
  // 진입 정책: 라이브 중이면 confirm modal 띄움 (종료 + 내보내기 = 비가역).
  // 비라이브 (페르소나 분석만 남은 상태) 면 confirm 없이 즉시 docx 생성.
  const hasPersonaContent = reflection !== null || history.length > 0;
  const canExport = (isLive || hasPersonaContent) && !exporting;

  const runExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      if (isLive) {
        try {
          await stopSession();
        } catch {
          // 정지 실패해도 export 자체는 진행 — 사용자 산출물 보존 우선.
        }
      }
      const starred = history.filter((h) => h.is_starred);
      const personaSnapshot = reflectionRef.current;
      const quotes = collectTranscriptQuotes(personaSnapshot);
      const endedAt = new Date();
      const startedAt = sessionStartedAtRef.current;

      const blob = await generatePersonaDocx({
        persona: personaSnapshot,
        starredQuestions: starred,
        transcriptQuotes: quotes,
        sessionMeta: {
          startedAt,
          endedAt,
          researchGoal: contextRef.current.research_goal,
          keyResearchQuestion: contextRef.current.key_research_question,
        },
      });
      const filename = buildPersonaFilename({
        persona: personaSnapshot,
        endedAt,
      });
      triggerBlobDownload(blob, filename);

      const hasAnyPanel =
        personaSnapshot !== null &&
        PROBING_PERSONA_SECTION_KEYS.some((k) => {
          const s = personaSnapshot[k];
          return (
            !!s &&
            ((typeof s.summary === 'string' && s.summary.trim().length > 0) ||
              (Array.isArray(s.signals) && s.signals.length > 0))
          );
        });
      if (!hasAnyPanel) {
        toast.push(
          '페르소나가 빈약한 상태로 내보냈어요 — 발화가 더 모이면 다시 시도해 보세요',
          { tone: 'warn' },
        );
      } else {
        toast.push('페르소나 docx 다운로드됨', { tone: 'info', ttlMs: 2200 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'export_failed';
      toast.push(`내보내기 실패 — ${msg}`, { tone: 'warn' });
    } finally {
      setExporting(false);
    }
  }, [exporting, history, isLive, stopSession, toast]);

  const handleExportClick = useCallback(() => {
    if (!canExport) return;
    if (isLive) {
      setExportConfirmOpen(true);
      return;
    }
    void runExport();
  }, [canExport, isLive, runExport]);

  const handleExportConfirm = useCallback(() => {
    setExportConfirmOpen(false);
    void runExport();
  }, [runExport]);

  const handleExportCancel = useCallback(() => {
    setExportConfirmOpen(false);
  }, []);

  // 세션 에러 토스트.
  const lastSessionErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionError) return;
    if (lastSessionErrorRef.current === sessionError) return;
    lastSessionErrorRef.current = sessionError;
    const human =
      sessionError === 'microphone_denied'
        ? '마이크 권한이 거절되었습니다 — 브라우저 권한을 허용해 주세요'
        : sessionError === 'microphone_failed'
          ? '마이크 캡처에 실패했습니다 — 다른 앱이 사용 중인지 확인해 주세요'
          : sessionError === 'tab_audio_denied'
            ? '탭 공유가 취소되었습니다'
            : sessionError === 'tab_audio_unavailable'
              ? "Chrome picker 에서 '탭 오디오 공유' 를 체크해 주세요"
              : sessionError === 'tab_audio_failed'
                ? '탭 오디오 캡처에 실패했습니다 — 다른 탭에서 다시 시도해 주세요'
                : sessionError === 'probing_timeout'
                  ? '네트워크 확인 후 다시 시작해 주세요'
                  : '세션 시작 실패 — 잠시 후 다시 시도해 주세요';
    toast.push(human, { tone: 'warn' });
  }, [sessionError, toast]);

  useEffect(() => {
    if (sessionStatus === 'idle') {
      lastSessionErrorRef.current = null;
    }
  }, [sessionStatus]);

  const statusLabel = (() => {
    if (sessionStatus === 'starting') return '세션 연결 중…';
    if (sessionStatus === 'stopping') return '세션 종료 중…';
    if (sessionStatus === 'error') return '세션 오류';
    if (!isLive) return '세션 대기';
    if (reflectionStatus === 'streaming') return '응답자 페르소나 갱신 중…';
    if (thinkingStreaming) return 'AI 사고 흐름 진행 중…';
    return '대기 중';
  })();

  const startDisabled =
    sessionStatus === 'starting' ||
    sessionStatus === 'live' ||
    sessionStatus === 'stopping';
  const stopDisabled =
    sessionStatus === 'idle' ||
    sessionStatus === 'starting' ||
    sessionStatus === 'stopping' ||
    sessionStatus === 'error';

  const canRefreshReflection =
    isLive &&
    hasTranscript &&
    cumulativeChars >= MIN_TRANSCRIPT_CHARS &&
    reflectionStatus !== 'streaming';

  const thinkCanRun =
    isLive &&
    hasTranscript &&
    cumulativeChars >= MIN_TRANSCRIPT_CHARS &&
    !thinkingStreaming;

  // 좌/우 패널 props.
  const reflectionPaneProps = {
    data: reflection,
    status: reflectionStatus,
    lastUpdatedAt: reflectionLastUpdatedAt,
    nowMs: now,
    error: reflectionError,
    canRefresh: canRefreshReflection,
    onRefresh: handleManualReflection,
    isLive,
    hasTranscript,
  };

  const questionPaneProps = {
    context,
    onContextChange: setContext,
    contextDisabled: !contextHydrated,
    thinkingEvents,
    thinkingStreaming,
    thinkCanRun,
    onManualThink: handleManualThink,
    activePopup,
    onPopupPin: handlePopupPin,
    onPopupCopy: handlePopupCopy,
    onPopupDismiss: handlePopupManualDismiss,
    onPopupAutoDismiss: handlePopupAutoDismiss,
    history,
    nowMs: now,
    onHistoryCopy: handleHistoryCopy,
    onHistoryToggleStar: handleHistoryToggleStar,
    onHistoryDelete: handleHistoryDelete,
    isLive,
    hasTranscript,
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <WidgetSubHeader
          className="shrink-0"
          inputs={
            <div className="flex items-center gap-2">
              <SourcePicker
                value={source}
                onChange={setSource}
                disabled={sessionStatus !== 'idle' && sessionStatus !== 'error'}
              />
              <OutputLangPicker
                value={outputLang}
                onChange={setOutputLang}
                disabled={sessionStatus !== 'idle' && sessionStatus !== 'error'}
              />
            </div>
          }
          actions={
            <>
              {canExport && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleExportClick}
                  loading={exporting}
                  loadingLabel="내보내는 중…"
                  title={
                    isLive
                      ? '인터뷰 종료 + 페르소나 docx 다운로드'
                      : '페르소나 docx 다운로드'
                  }
                >
                  {isLive ? '📥 종료 + 내보내기' : '📥 내보내기'}
                </Button>
              )}
              {isLive ? (
                <ChromeButton
                  size="lg"
                  onClick={handleStopSession}
                  disabled={stopDisabled}
                >
                  정지
                </ChromeButton>
              ) : (
                <ChromeButton
                  variant="primary"
                  size="lg"
                  onClick={handleStartSession}
                  disabled={startDisabled}
                >
                  세션 시작
                </ChromeButton>
              )}
            </>
          }
          hint={
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  isLive
                    ? 'bg-amore'
                    : sessionStatus === 'error'
                      ? 'bg-warning'
                      : 'bg-line'
                }`}
                aria-hidden
              />
              <SectionLabel>{statusLabel}</SectionLabel>
            </div>
          }
        />

        {/* 본문 — canvas card (preview) 는 3 section 만: 사고 흐름 / 중앙
            popup / 질문 기록. 페르소나 8 패널 + 조사 입력은 fullview modal
            (ProbingFullView) 에만 노출.
            모달 open 시 카드 본문은 placeholder 로 교체 — 같은 hook(state)
            인스턴스를 모달과 공유하므로 데이터는 보존되고, 시각적으로 두
            곳에 동시에 그려지지 않는다 (spec: 두 instance 시각 0). */}
        {isCurrent ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm italic text-mute-soft">
            전체 보기에서 작업 중 — 모달을 닫으면 여기로 돌아옵니다.
          </div>
        ) : (
          <ProbingCanvasCardBody
            thinkingEvents={thinkingEvents}
            thinkingStreaming={thinkingStreaming}
            activePopup={activePopup}
            onPopupPin={handlePopupPin}
            onPopupCopy={handlePopupCopy}
            onPopupDismiss={handlePopupManualDismiss}
            onPopupAutoDismiss={handlePopupAutoDismiss}
            history={history}
            nowMs={now}
            onHistoryCopy={handleHistoryCopy}
            onHistoryToggleStar={handleHistoryToggleStar}
            onHistoryDelete={handleHistoryDelete}
            isLive={isLive}
          />
        )}

        {thinkingError && (
          <div
            className="m-3 bg-paper px-3 py-2 text-sm text-warning"
            style={{
              border: '2px solid var(--color-warning)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            AI 사고 흐름 실패: {thinkingError}
          </div>
        )}
      </div>

      {renderInSlot(
        <WidgetFullviewPanel
          title="프로빙 어시스턴트"
          subtitle={
            context.research_goal?.trim()
              ? context.research_goal
              : isLive
                ? '인터뷰 진행 중'
                : '응답자 페르소나 + 프로빙 질문'
          }
          onClose={close}
        >
          <ProbingFullView
            reflectionProps={reflectionPaneProps}
            questionProps={questionPaneProps}
          />
        </WidgetFullviewPanel>,
      )}

      {exportConfirmOpen && (
        <Modal
          open
          onClose={handleExportCancel}
          size="sm"
          labelledBy="probing-export-confirm-title"
        >
          <div className="flex flex-col gap-4 p-6">
            <h2
              id="probing-export-confirm-title"
              className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
            >
              인터뷰를 종료하고 페르소나를 내보낼까요?
            </h2>
            <p className="text-sm leading-snug text-mute">
              현재 세션을 정지하고, 지금까지 누적된 페르소나 8 패널과 ★ 핵심
              질문, 인용된 transcript 발화를 docx 파일로 다운로드합니다. 정지
              후에는 이 세션을 다시 이어 받을 수 없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportCancel}
                disabled={exporting}
              >
                취소
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportConfirm}
                loading={exporting}
                loadingLabel="내보내는 중…"
              >
                종료 + 내보내기
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// PROBING_TECHNIQUES / PROBING_THINK_IMPORTANCE re-import 차단 회피 —
// types 가 ProbingTechnique union 을 사용하므로 schema 모듈이 tree-shake
// 됐을 때 enum 누락 방지용 reference. (런타임 영향 X)
void PROBING_TECHNIQUES;
void PROBING_THINK_IMPORTANCE;

export const probingCard: WidgetContent = {
  key: 'probing',
  meta: {
    label: '프로빙 어시스턴트',
    accent: 'sky',
    cost: 25,
    thumbnail: '/thumbnail/probing.png',
    description:
      '좌측은 응답자 페르소나 8 패널, 우측은 사용자가 입력한 조사 목적·핵심 가설·KRQ 를 기반으로 AI 가 사고 흐름과 즉시 던질 질문 popup 을 보내줍니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
