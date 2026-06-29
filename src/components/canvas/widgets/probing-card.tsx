'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   PR (probing-two-pane-reflection): 단일 30s/3q 에이전트를 **좌(성찰) +
   우(질문) 두 에이전트** 로 분리.
   - 좌패널 (ReflectionPane): 누적 transcript 를 읽고 응답자에 대한 세
     섹션 가설 (respondent / needs_painpoints / motivation) 을 출력.
     transcript 변경 5초 debounce + 누적 60자 이상에서 자동 호출.
   - 우패널 (QuestionPane): 좌패널 성찰을 컨텍스트로 검증·심화 질문 제안.
     좌 reflection 완료 시 자동 1회 trigger + 사용자 "지금 제안" 수동.

   기존 30s/3q 자동 타이머, paused 토글, "자동 정지" 버튼은 폐기. 호출
   주기가 transcript-driven (debounce) 으로 변경되며 사용자 노이즈가
   훨씬 줄어든다.

   세션 lifecycle / source picker / guide / 파일 import 흐름은 그대로
   재사용. transcript 수집 hook (useRealtimeTranscription) 도 동일.

   영속화: 우패널 질문은 기존 probing_questions 테이블 재사용 (POST/
   PATCH/DELETE 그대로). 좌패널 reflection 은 in-memory only — 세션
   생존, 새로고침 시 비움. DB schema 추가는 후속 PR.
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
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/textarea';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import {
  GUIDE_MAX_CHARS,
  getStoredGuide,
  saveGuide,
} from '@/lib/probing-guide-storage';
import {
  GuideImportError,
  importGuideFile,
} from '@/lib/probing-guide-import';
import type {
  ProbingQuestion,
  ProbingQuestionRow,
  ProbingSuggestionSet,
} from './probing-types';
import {
  ReflectionPane,
  type ProbingReflectionData,
  type ReflectionStatus,
} from './probing/reflection-pane';
import { QuestionPane } from './probing/question-pane';
import { ProbingFullView } from './probing/full-view';

// transcript window — 우패널 (suggest) 가 받는 최근 발화 윈도우. 좌패널
// reflection 은 누적 전체 (cap 만 적용).
const SUGGEST_WINDOW_MS = 30_000;
// 좌패널이 모델에 보낼 누적 transcript 의 최대 길이 — 시간이 길수록 chars
// 가 누적되니 60_000 자에서 잘라낸다 (suggest 와 동일 cap).
const REFLECTION_MAX_CHARS = 60_000;
// 가이드 textarea localStorage 저장 debounce.
const GUIDE_SAVE_DEBOUNCE_MS = 500;
// transcript 가 의미 있게 모인 뒤에야 좌/우 모두 호출. 60자 미만이면 skip.
// (suggest 의 server min 은 30 자, 좌 reflection 도 30 자에서 통과되지만
//  너무 짧은 발화로 가설을 만들면 hallucination 가능성 ↑ → 클라이언트는
//  60자에서부터 호출.)
const MIN_TRANSCRIPT_CHARS = 60;
// transcript 변경 → reflection 호출까지의 debounce. 발화가 흐르는 중엔
// 자꾸 재호출하지 않고, 침묵 5초가 흐른 시점에 한 번 갱신.
const REFLECTION_DEBOUNCE_MS = 5_000;
// 위젯에 표시할 / fetch 할 최근 질문 갯수.
const DISPLAY_LIMIT = 50;
// 우패널 한 호출당 질문 수.
const QUESTIONS_PER_CALL = 3;

// transcript 가 멈춰 있을 때도 cutoff 가 흐르도록 1초마다 강제 리렌더.
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

// 좌패널 reflection 텍스트 → 우패널 prompt 에 넣을 합본. 빈 섹션은 skip.
function reflectionToPromptContext(
  data: ProbingReflectionData | null,
): string {
  if (!data) return '';
  const blocks: string[] = [];
  const push = (title: string, body: string) => {
    const trimmed = body?.trim();
    if (trimmed && trimmed !== '단서 부족') {
      blocks.push(`### ${title}\n${trimmed}`);
    }
  };
  push('응답자 (지금까지의 단서)', data.respondent);
  push('니즈 / 페인포인트', data.needs_painpoints);
  push('응답 동기 / 사고 흐름', data.motivation);
  return blocks.join('\n\n');
}

type SourceKind = 'mic' | 'tab';

// 입력 소스 dropdown — translate-console 의 settings dropdown 과 동일 시각
// (label 위 + h-8 rounded-xs border-line bg-paper). 위젯 간 settings 영역
// 디자인 통일 (PR-probing-translate-settings-unify).
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
    <label className="flex flex-col gap-1 text-sm text-mute">
      <span>입력 소스</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SourceKind)}
        disabled={disabled}
        className="h-8 rounded-xs border border-line bg-paper px-2 text-md text-ink"
      >
        <option value="mic">마이크</option>
        <option value="tab">탭 오디오</option>
      </select>
    </label>
  );
}

function GuideSection({
  value,
  onChange,
  open,
  onToggle,
  onImportClick,
  importing,
}: {
  value: string;
  onChange: (next: string) => void;
  open: boolean;
  onToggle: () => void;
  onImportClick: () => void;
  importing: boolean;
}) {
  const count = value.length;
  const label = count === 0 ? '가이드 추가' : `가이드 (${count.toLocaleString()}자)`;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="link"
        size="xs"
        onClick={onToggle}
        aria-expanded={open}
        leftIcon={
          <svg
            viewBox="0 0 24 24"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`transition-transform duration-[120ms] ${open ? 'rotate-90' : ''}`}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        }
        className="self-start uppercase tracking-[0.18em]"
      >
        {label}
      </Button>
      {open && (
        <>
          <div className="flex items-center justify-end">
            <Button
              variant="secondary"
              size="xs"
              onClick={onImportClick}
              disabled={importing}
              loading={importing}
              loadingLabel="가져오는 중…"
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  width="11"
                  height="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 3 14 8 19 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9 15 12 12 15 15" />
                </svg>
              }
              className="uppercase tracking-[0.18em]"
            >
              파일 가져오기
            </Button>
          </div>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, GUIDE_MAX_CHARS))}
            rows={3}
            maxLength={GUIDE_MAX_CHARS}
            placeholder="조사 목적 / 핵심 가설 / 질문 의도 등을 자유롭게 입력하세요. 비워두면 transcript 만 보고 제안합니다."
            helper={`${count.toLocaleString()} / ${GUIDE_MAX_CHARS.toLocaleString()}자  ·  .md / .txt / .docx 가져오기 지원`}
            className="max-h-28 text-md resize-none"
          />
        </>
      )}
    </div>
  );
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

  // 전체보기 모달 toggle. 같은 컴포넌트 tree 안에서 모달 mount/unmount —
  // reflection / question state 는 부모 (이 함수) 가 single source 라
  // close 시 widget 모드로 복귀해도 state 유실 0.
  const [expanded, setExpanded] = useState(false);
  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleCollapse = useCallback(() => setExpanded(false), []);

  const [guide, setGuide] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time localStorage hydration; useState(() => getStoredGuide()) would cause SSR/client mismatch when localStorage has content.
    setGuide(getStoredGuide());
  }, []);
  useEffect(() => {
    const id = setTimeout(() => saveGuide(guide), GUIDE_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [guide]);
  const guideRef = useRef(guide);
  useEffect(() => {
    guideRef.current = guide;
  }, [guide]);

  const isLive = sessionStatus === 'live';

  // 헤더 pill 로 push 할 live state. progress 없는 realtime 위젯 — label 만.
  //   starting → CONNECTING / live → LIVE / stopping → STOPPING
  //   error → error (+ message) / idle → idle
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

  // 좌패널 — Reflection state. 위젯 in-memory only.
  const [reflection, setReflection] = useState<ProbingReflectionData | null>(null);
  const [reflectionStatus, setReflectionStatus] = useState<ReflectionStatus>('idle');
  const [reflectionLastUpdatedAt, setReflectionLastUpdatedAt] = useState<number | null>(null);
  const [reflectionError, setReflectionError] = useState<string | null>(null);
  const reflectionInFlightRef = useRef(false);
  const reflectionRef = useRef<ProbingReflectionData | null>(null);
  useEffect(() => {
    reflectionRef.current = reflection;
  }, [reflection]);

  // 우패널 — 질문 list.
  const [current, setCurrent] = useState<ProbingSuggestionSet | null>(null);
  const [suggestStreaming, setSuggestStreaming] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ProbingQuestionRow[]>([]);
  const [hydrating, setHydrating] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const suggestInFlightRef = useRef(false);

  // 누적 segments — 좌패널이 전체 transcript 를 본다. 우패널은 별도 30s window.
  const hasTranscript = rawSegments.length > 0;
  const rawSegmentsRef = useRef(rawSegments);
  useEffect(() => {
    rawSegmentsRef.current = rawSegments;
  }, [rawSegments]);

  // 누적 transcript 의 length (좌패널 트리거 threshold 점검용).
  const cumulativeChars = useMemo(
    () => rawSegments.reduce((sum, s) => sum + s.text.trim().length, 0),
    [rawSegments],
  );

  // mount 시 1회 — 최근 N개 DB row 를 가져와 list 초기화.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/probing/questions?limit=${DISPLAY_LIMIT}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
        const j = (await res.json()) as {
          rows?: Array<{
            id: string;
            text: string;
            technique: string;
            why: string | null;
            guide_reference: string | null;
            is_core: boolean | null;
            created_at: string;
          }>;
        };
        if (cancelled) return;
        const rows: ProbingQuestionRow[] = (j.rows ?? [])
          .map((r) => ({
            id: r.id,
            created_at: r.created_at,
            text: r.text ?? '',
            technique: r.technique ?? 'tell_more',
            why: r.why ?? '',
            guide_reference: r.guide_reference ?? null,
            is_core: r.is_core === true,
          }))
          .filter((r) => r.text.trim().length > 0);
        setQuestions(rows);
      } catch {
        // 영속화는 best-effort. fetch 실패 = 새 세션처럼 빈 list 에서 시작.
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── 우패널 persist (POST per question, 기존 PR-12 흐름 그대로) ───
  const persistQuestions = useCallback(
    async (
      streamingId: string,
      stream: ProbingQuestion[],
      cutoff: string,
    ) => {
      const startedAt = Date.now();
      const tasks = stream.map((q, idx) =>
        (async (): Promise<ProbingQuestionRow> => {
          try {
            const res = await fetch('/api/probing/questions', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                text: q.text,
                technique: q.technique,
                why: q.why,
                transcript_cutoff: cutoff,
              }),
            });
            if (res.ok) {
              const j = (await res.json()) as {
                row?: {
                  id: string;
                  text: string;
                  technique: string;
                  why: string | null;
                  guide_reference: string | null;
                  is_core: boolean | null;
                  created_at: string;
                };
              };
              if (j.row) {
                return {
                  id: j.row.id,
                  created_at: j.row.created_at,
                  text: j.row.text,
                  technique: j.row.technique,
                  why: j.row.why ?? '',
                  guide_reference: j.row.guide_reference ?? null,
                  is_core: j.row.is_core === true,
                };
              }
            }
          } catch {
            // fall through — fallback row 으로 떨어짐
          }
          const localCreated = new Date(startedAt - idx).toISOString();
          return {
            id: `local-${startedAt}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            created_at: localCreated,
            text: q.text,
            technique: q.technique,
            why: q.why,
            guide_reference: null,
            is_core: false,
          };
        })(),
      );
      const settled = await Promise.allSettled(tasks);
      const rows: ProbingQuestionRow[] = settled
        .map((s) => (s.status === 'fulfilled' ? s.value : null))
        .filter((r): r is ProbingQuestionRow => r !== null);
      if (rows.length > 0) {
        setQuestions((prev) =>
          [...rows, ...prev].slice(0, DISPLAY_LIMIT),
        );
      }
      setCurrent((cur) => (cur?.id === streamingId ? null : cur));
    },
    [],
  );

  // ─── 우패널 — Question Agent 호출 ───
  const runSuggest = useCallback(async () => {
    if (suggestInFlightRef.current) return;
    const cutoff = Date.now() - SUGGEST_WINDOW_MS;
    const segs = rawSegmentsRef.current.filter((s) => s.started_at >= cutoff);
    const text = segmentsText(segs);
    if (text.length < 30) {
      // suggest 의 server min 은 30. 그 미만은 skip.
      return;
    }

    suggestInFlightRef.current = true;
    setSuggestStreaming(true);
    setSuggestError(null);

    const setId = `probing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const started_at = Date.now();

    let finalQuestions: ProbingQuestion[] = [];
    let succeeded = false;

    try {
      const res = await fetch('/api/probing/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: text,
          interview_guide: guideRef.current,
          reflection_context: reflectionToPromptContext(reflectionRef.current),
          max_questions: QUESTIONS_PER_CALL,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `suggest_failed_${res.status}`);
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
      const obj = parsed.value as
        | {
            questions?: Array<{
              text?: string;
              technique?: string;
              why_sharp?: string;
            }>;
            intents?: string[];
          }
        | null;
      if (obj && Array.isArray(obj.questions)) {
        const clean: ProbingQuestion[] = obj.questions
          .filter(
            (q): q is { text?: string; technique?: string; why_sharp?: string } =>
              !!q,
          )
          .map((q) => ({
            text: typeof q.text === 'string' ? q.text : '',
            technique:
              typeof q.technique === 'string' ? q.technique : 'tell_more',
            why: typeof q.why_sharp === 'string' ? q.why_sharp : '',
            why_sharp:
              typeof q.why_sharp === 'string' ? q.why_sharp : undefined,
          }))
          .filter((q) => q.text.trim().length > 0);
        if (clean.length > 0) {
          setCurrent({ id: setId, created_at: started_at, questions: clean });
          finalQuestions = clean;
        }
      }
      succeeded = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'suggest_failed';
      setSuggestError(msg);
      toast.push('제안 생성 실패 — 잠시 후 다시 시도해 주세요', {
        tone: 'warn',
      });
      setCurrent(null);
    } finally {
      suggestInFlightRef.current = false;
      setSuggestStreaming(false);
    }

    if (succeeded && finalQuestions.length > 0) {
      void persistQuestions(setId, finalQuestions, text);
    }
  }, [persistQuestions, toast]);

  const runSuggestRef = useRef(runSuggest);
  useEffect(() => {
    runSuggestRef.current = runSuggest;
  }, [runSuggest]);

  // ─── 좌패널 — Reflection Agent 호출 ───
  const runReflection = useCallback(
    async (opts: { triggerQuestionsOnSuccess: boolean }) => {
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
            interview_guide: guideRef.current,
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
        const obj = parsed.value as
          | {
              respondent?: string;
              needs_painpoints?: string;
              motivation?: string;
            }
          | null;
        if (
          obj &&
          (obj.respondent || obj.needs_painpoints || obj.motivation)
        ) {
          const next: ProbingReflectionData = {
            respondent: typeof obj.respondent === 'string' ? obj.respondent : '',
            needs_painpoints:
              typeof obj.needs_painpoints === 'string' ? obj.needs_painpoints : '',
            motivation: typeof obj.motivation === 'string' ? obj.motivation : '',
          };
          setReflection(next);
          setReflectionLastUpdatedAt(Date.now());
          setReflectionStatus('ready');
          if (opts.triggerQuestionsOnSuccess) {
            // 좌 갱신 → 우 자동 trigger (1회). reflection ref 가 위에서 set
            // 됐으므로 다음 tick 에 runSuggest 가 최신 reflection 을 본다.
            queueMicrotask(() => {
              void runSuggestRef.current();
            });
          }
          return;
        }
        throw new Error('empty_reflection');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'reflection_failed';
        setReflectionError(msg);
        setReflectionStatus('error');
        toast.push('성찰 생성 실패 — 잠시 후 다시 시도해 주세요', {
          tone: 'warn',
        });
      } finally {
        reflectionInFlightRef.current = false;
      }
    },
    [toast],
  );

  const runReflectionRef = useRef(runReflection);
  useEffect(() => {
    runReflectionRef.current = runReflection;
  }, [runReflection]);

  // ─── 자동 트리거: transcript 변경 → 5초 debounce → reflection ───
  useEffect(() => {
    if (!isLive) return;
    if (cumulativeChars < MIN_TRANSCRIPT_CHARS) return;
    const id = setTimeout(() => {
      void runReflectionRef.current({ triggerQuestionsOnSuccess: true });
    }, REFLECTION_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [rawSegments, cumulativeChars, isLive]);

  // 새 세션 시작 시 in-memory 상태 리셋.
  const prevLiveRef = useRef(false);
  useEffect(() => {
    const prev = prevLiveRef.current;
    if (!prev && isLive) {
      setReflection(null);
      setReflectionStatus('idle');
      setReflectionLastUpdatedAt(null);
      setReflectionError(null);
      setCurrent(null);
      setSuggestError(null);
    }
    prevLiveRef.current = isLive;
  }, [isLive]);

  // 수동 트리거 — 좌 갱신.
  const handleManualReflection = useCallback(() => {
    void runReflectionRef.current({ triggerQuestionsOnSuccess: true });
  }, []);

  // 수동 트리거 — 우 제안.
  const handleManualSuggest = useCallback(() => {
    void runSuggestRef.current();
  }, []);

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push('복사됨', { tone: 'info', ttlMs: 1800 });
    } catch {
      toast.push('복사 실패 — 직접 선택해서 복사해 주세요', { tone: 'warn' });
    }
  }

  const handleToggleCore = useCallback(
    async (id: string) => {
      let prevValue: boolean | null = null;
      let nextValue: boolean | null = null;
      setQuestions((prev) =>
        prev.map((q) => {
          if (q.id !== id) return q;
          prevValue = q.is_core;
          nextValue = !q.is_core;
          return { ...q, is_core: nextValue };
        }),
      );
      if (prevValue === null || nextValue === null) return;
      if (id.startsWith('local-')) return;
      try {
        const res = await fetch(
          `/api/probing/questions/${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ is_core: nextValue }),
          },
        );
        if (!res.ok) throw new Error(`patch_failed_${res.status}`);
      } catch {
        const restored = prevValue;
        setQuestions((prev) =>
          prev.map((q) => (q.id === id ? { ...q, is_core: restored } : q)),
        );
        toast.push('핵심 표시 저장 실패 — 잠시 후 다시 시도해 주세요', {
          tone: 'warn',
        });
      }
    },
    [toast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      let removed: ProbingQuestionRow | null = null;
      let removedIndex = -1;
      setQuestions((prev) => {
        const idx = prev.findIndex((q) => q.id === id);
        if (idx === -1) return prev;
        removed = prev[idx]!;
        removedIndex = idx;
        return prev.filter((_, i) => i !== idx);
      });
      setSelectedId((cur) => (cur === id ? null : cur));
      if (!removed) return;
      if (id.startsWith('local-')) return;
      try {
        const res = await fetch(
          `/api/probing/questions/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(`delete_failed_${res.status}`);
      } catch {
        const restored = removed;
        const idx = removedIndex;
        setQuestions((prev) => {
          const next = [...prev];
          next.splice(Math.min(idx, next.length), 0, restored);
          return next.slice(0, DISPLAY_LIMIT);
        });
        toast.push('삭제 실패 — 잠시 후 다시 시도해 주세요', { tone: 'warn' });
      }
    },
    [toast],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // selectedId 가 있을 때만 esc 리스너.
  useEffect(() => {
    if (selectedId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // 파일 import — 기존 흐름 그대로.
  const runImport = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const { text, truncated } = await importGuideFile(file);
        setGuide(text);
        setGuideOpen(true);
        if (truncated) {
          toast.push(
            `가이드 최대 ${GUIDE_MAX_CHARS.toLocaleString()}자까지 — 이후 부분 잘림`,
            { tone: 'warn' },
          );
        } else {
          toast.push(`가이드 가져옴 — ${text.length.toLocaleString()}자`, {
            tone: 'info',
            ttlMs: 2000,
          });
        }
      } catch (e) {
        const code = e instanceof GuideImportError ? e.code : 'parse_failed';
        const msg =
          code === 'unsupported_type'
            ? '지원하지 않는 파일 형식입니다 (.md, .txt, .docx 만 가능)'
            : code === 'too_large'
              ? '파일이 너무 큽니다 — 5MB 이하만 가져올 수 있습니다'
              : '파일을 읽을 수 없습니다 — 확인 후 다시 시도해 주세요';
        toast.push(msg, { tone: 'warn' });
      } finally {
        setImporting(false);
      }
    },
    [toast],
  );

  function handleImportClick() {
    if (importing) return;
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (guide.trim().length > 0) {
      setPendingFile(file);
      return;
    }
    void runImport(file);
  }

  function handleConfirmReplace() {
    const file = pendingFile;
    setPendingFile(null);
    if (file) void runImport(file);
  }

  // 세션 시작 / 정지.
  const handleStartSession = useCallback(async () => {
    await startSession({ source });
  }, [startSession, source]);

  const handleStopSession = useCallback(async () => {
    await stopSession();
  }, [stopSession]);

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

  // 상태 라벨 — 자동 호출 카운트다운이 사라졌으므로 단순화.
  const statusLabel = (() => {
    if (sessionStatus === 'starting') return '세션 연결 중…';
    if (sessionStatus === 'stopping') return '세션 종료 중…';
    if (sessionStatus === 'error') return '세션 오류';
    if (!isLive) return '세션 대기';
    if (reflectionStatus === 'streaming') return '응답자 성찰 갱신 중…';
    if (suggestStreaming) return '질문 제안 생성 중…';
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

  const canSuggest =
    isLive && hasTranscript && !suggestStreaming;

  const hasReflection = reflection !== null;

  // 좌/우 패널 props — widget 모드와 전체보기 모달 양쪽에 동일 인스턴스로
  // 전달. 같은 React state 를 read 하므로 모드 토글 시 데이터 끊김 0.
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
    current,
    questions,
    streaming: suggestStreaming,
    hydrating,
    selectedId,
    nowMs: now,
    isLive,
    hasTranscript,
    hasReflection,
    canSuggest,
    onSuggest: handleManualSuggest,
    onSelect: handleSelect,
    onCopy: (t: string) => {
      void handleCopy(t);
    },
    onToggleCore: (id: string) => {
      void handleToggleCore(id);
    },
    onDelete: (id: string) => {
      void handleDelete(id);
    },
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {/* 상단 — source picker + 세션 시작/정지 + 가이드. settings 영역은
            translate-console 과 동일 패턴 — items-end 정렬, dropdown 옆에
            h-8 ChromeButton (시작/정지) + h-8 IconButton (전체보기) 라인. */}
        <div className="flex shrink-0 flex-col gap-3 border-b border-line-soft px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <SourcePicker
              value={source}
              onChange={setSource}
              disabled={sessionStatus !== 'idle' && sessionStatus !== 'error'}
            />
            <div className="ml-auto flex items-center gap-2">
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
              <IconButton
                aria-label="전체보기 열기"
                title="전체보기"
                variant="ghost"
                size="lg"
                onClick={handleExpand}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </IconButton>
            </div>
          </div>

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

          <GuideSection
            value={guide}
            onChange={setGuide}
            open={guideOpen}
            onToggle={() => setGuideOpen((o) => !o)}
            onImportClick={handleImportClick}
            importing={importing}
          />
          {/* eslint-disable-next-line react/forbid-elements -- hidden file picker triggered programmatically; <Input> primitive's label/helper wrapper is unnecessary chrome for an invisible element. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden
            tabIndex={-1}
          />
        </div>

        {/* 본문 — 좌(성찰) / 우(질문) 2-pane. divide-x 로 vertical divider. */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] divide-x divide-line-soft overflow-hidden">
          <ReflectionPane {...reflectionPaneProps} />
          <QuestionPane {...questionPaneProps} />
        </div>

        {suggestError && (
          <div
            className="m-3 bg-paper px-3 py-2 text-sm text-warning"
            style={{
              border: '2px solid var(--color-warning)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            제안 생성 실패: {suggestError}
          </div>
        )}
      </div>

      {/* 전체보기 — 풀스크린 모달. backdrop click 으로 실수 close 회피
          (dismissOnBackdrop=false). ESC + 헤더 ✕ 만 허용. modal 안의
          ReflectionPane / QuestionPane 은 widget 모드와 같은 React
          state 를 read — close 시 widget 으로 돌아가도 끊김 0. */}
      {expanded && (
        <Modal
          open
          onClose={handleCollapse}
          size="full"
          dismissOnBackdrop={false}
          labelledBy="probing-full-view-title"
        >
          <h2 id="probing-full-view-title" className="sr-only">
            프로빙 어시스턴트 — 전체보기
          </h2>
          <ProbingFullView
            reflectionProps={reflectionPaneProps}
            questionProps={questionPaneProps}
            onClose={handleCollapse}
          />
        </Modal>
      )}

      {pendingFile && (
        <Modal
          open
          onClose={() => setPendingFile(null)}
          size="sm"
          title="가이드를 교체할까요?"
          description={`현재 가이드 (${guide.length.toLocaleString()}자) 가 가져온 파일 내용으로 교체됩니다. 되돌릴 수 없습니다.`}
          footer={
            <>
              <Button
                variant="link"
                size="sm"
                onClick={() => setPendingFile(null)}
                className="uppercase tracking-[0.18em]"
              >
                취소
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmReplace}
                className="uppercase tracking-[0.18em]"
              >
                교체
              </Button>
            </>
          }
        >
          <p className="text-md leading-[1.6] text-mute">
            파일: <span className="text-ink-2">{pendingFile.name}</span>
          </p>
        </Modal>
      )}
    </>
  );
}

export const probingCard: WidgetContent = {
  key: 'probing',
  meta: {
    label: '프로빙 어시스턴트',
    accent: 'sky',
    // ledger cost — 1 tick (1시간) 당 25 크레딧. translate 와 동일 lifecycle
    // 패턴 (시작 lump + 시간당 추가) 이라 헤더는 표준 💎25 pill 만 — 다른
    // 위젯과 시각 통일. 라이프사이클 (4시간 cap = 100 credit) 상세는
    // /credits 페이지의 Features.probing.cost 라벨이 책임.
    cost: 25,
    thumbnail: '/thumbnail/probing.png',
    description:
      '좌측은 응답자에 대한 성찰, 우측은 그 성찰을 검증·심화하는 probing 질문을 자동 갱신합니다',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
