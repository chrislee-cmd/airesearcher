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
import { ShareInviteButton } from '@/components/share/share-invite-button';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';
import { track as trackEvent } from '@/lib/analytics/events';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import { exportDomToPdf } from '@/lib/export/pdf-from-dom';
import { buildPersonaFilename } from '@/lib/probing-persona-docx';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
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
import type { ProbingBackfillFeedback } from './probing/research-context';
import { ProbingCanvasCardBody } from './probing/canvas-card-body';
import { ProbingFullView } from './probing/full-view';
import {
  ProbingControlPanel,
  type SourceKind,
} from './probing/control-board';
import { useCustomSections, CUSTOM_SECTION_MAX } from './probing/use-custom-sections';
import { useHiddenDefaults } from './probing/use-hidden-defaults';
import {
  DEFAULT_PERSONA_SECTIONS,
  PROBING_PERSONA_SECTION_KEYS,
  PROBING_TECHNIQUES,
  PROBING_THINK_IMPORTANCE,
  probingThinkEmitSchema,
  type ProbingOutputLang,
  type ProbingPersonaSection,
} from '@/lib/probing-prompts';
import {
  CUSTOM_WEIGHT,
  DEFAULT_WEIGHT,
  sectionFillRate,
  type ProbingWidgetStatus,
} from '@/lib/probing-widget-weight';

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

// 검증 helper — think route 의 EMIT 라인 JSON 을 schema 로 통과시킨다.
// resolveTargetLabel: target_section alias → 위젯 라벨 (popup 뱃지용). alias 가
// 이번 think 호출의 위젯 집합에 없으면 undefined → 뱃지 미표시.
function parseEmit(
  raw: string,
  resolveTargetLabel?: (alias: string) => string | undefined,
): PopupQuestion | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = probingThinkEmitSchema.safeParse(parsed);
    if (!result.success) return null;
    const { text, technique, rationale, importance, target_section } =
      result.data;
    const id = `popup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetLabel =
      target_section && resolveTargetLabel
        ? resolveTargetLabel(target_section)
        : undefined;
    return {
      id,
      text,
      technique,
      rationale,
      importance,
      emitted_at: Date.now(),
      target_section_label: targetLabel,
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
    renewing: sessionRenewing,
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

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'probing' });
  }, []);

  // Analytics — 통역/프로빙 세션 job_completed 계측. 라이브 진입 시각을
  // 잡아 라이브를 벗어날 때 duration 을 계산한다. 시작이 실패해 live 에
  // 도달 못 하면 (startedAt null) completed 를 발화하지 않는다. 정지 버튼 ·
  // PDF export 종료 · 언마운트 모두 이 effect 로 커버된다.
  const sessionStartAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionStatus === 'live') {
      if (sessionStartAtRef.current === null) {
        sessionStartAtRef.current = Date.now();
      }
      return;
    }
    if (sessionStartAtRef.current !== null) {
      const startedAt = sessionStartAtRef.current;
      sessionStartAtRef.current = null;
      trackEvent('job_completed', {
        widget: 'probing',
        job_type: 'session',
        duration_ms: Math.max(0, Date.now() - startedAt),
      });
    }
  }, [sessionStatus]);

  // ─── 우패널 입력 — research_context (DB upsert) ───
  const [context, setContext] = useState<ResearchContext>({
    research_goal: '',
    hypotheses: [],
    key_research_question: '',
  });
  const [contextHydrated, setContextHydrated] = useState(false);
  // probing_sessions.id — 공유 링크(#477) resource_id(probing_persona). 컨텍스트가
  // 저장되기 전(GET row 없음)에는 null 이라 공유 버튼이 비활성.
  const [probingSessionId, setProbingSessionId] = useState<string | null>(null);
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // mount 시 1회 — 마지막으로 저장한 컨텍스트 hydrate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth('/api/probing/research-context', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
        const j = (await res.json()) as {
          row?: {
            id?: string | null;
            research_goal?: string;
            hypotheses?: string[];
            key_research_question?: string;
          };
        };
        if (cancelled) return;
        if (j.row) {
          setProbingSessionId(j.row.id ?? null);
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
          const res = await fetchWithAuth('/api/probing/research-context', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              research_goal: contextRef.current.research_goal,
              hypotheses: contextRef.current.hypotheses,
              key_research_question:
                contextRef.current.key_research_question,
            }),
          });
          // 저장 직후 probing_sessions.id 확보 — 공유 버튼(#477) 활성화용.
          if (res.ok) {
            const j = (await res.json().catch(() => null)) as {
              row?: { id?: string | null };
            } | null;
            if (j?.row?.id) setProbingSessionId(j.row.id);
          }
        } catch {
          // best-effort. 사용자에게 토스트는 부담스러우니 silent.
        }
      })();
    }, 800);
    return () => clearTimeout(handle);
  }, [context, contextHydrated]);

  // ─── custom 섹션 (PR: probing-custom-section-ui) — localStorage 영속 ───
  // 우패널 "+ 위젯 추가" 로 정의, 좌패널 페르소나 grid 에 8 기본 뒤 append.
  // reflection 자동 호출은 useCallback 안에서 ref 로 최신 값을 읽는다.
  const {
    sections: customSections,
    add: addCustomSection,
    remove: removeCustomSection,
  } = useCustomSections();
  const customSectionsRef = useRef(customSections);
  useEffect(() => {
    customSectionsRef.current = customSections;
  }, [customSections]);

  // ─── custom 위젯 backfill + 우선 질문 (PR: probing-custom-widget-backfill-
  //     and-priority-question) ───
  // 새 커스텀 위젯을 만들면 누적 대화를 재분석해 (a) 채울 내용이 있으면 즉시
  // reflection 에 병합하고 (b) 없으면 emptyCustomRef 에 모아 think 의
  // priority_sections 로 넘겨 AI 가 그 위젯을 채우는 질문을 우선 제안하게 한다.
  // reflection 이 나중에 그 섹션을 채우면 ref 에서 제거된다.
  const [backfillFeedback, setBackfillFeedback] =
    useState<ProbingBackfillFeedback | null>(null);
  const emptyCustomRef = useRef<
    Map<string, { title: string; description?: string }>
  >(new Map());
  const backfillFeedbackTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // 진행 중은 유지, 종료 상태 (backfilled/empty) 는 몇 초 후 자동 사라짐.
  const showBackfillFeedback = useCallback(
    (fb: ProbingBackfillFeedback | null) => {
      if (backfillFeedbackTimerRef.current) {
        clearTimeout(backfillFeedbackTimerRef.current);
        backfillFeedbackTimerRef.current = null;
      }
      setBackfillFeedback(fb);
      if (fb && fb.status !== 'running') {
        backfillFeedbackTimerRef.current = setTimeout(() => {
          setBackfillFeedback(null);
          backfillFeedbackTimerRef.current = null;
        }, 6000);
      }
    },
    [],
  );
  useEffect(
    () => () => {
      if (backfillFeedbackTimerRef.current) {
        clearTimeout(backfillFeedbackTimerRef.current);
      }
    },
    [],
  );

  // ─── 기본 8 위젯 개별 숨김 (PR: probing-default-persona-widgets-hide) ───
  // UI-only hide — backend 는 여전히 기본 8 을 required 로 채우고, 여기선
  // 렌더 필터만. localStorage 영속, restore 로 즉시 재노출.
  const {
    hiddenKeys: hiddenDefaultKeys,
    hide: hideDefault,
    restore: restoreDefault,
    restoreAll: restoreAllDefaults,
  } = useHiddenDefaults();
  // think 자동 호출 (useCallback, ref 로 최신값 읽음) 에서 숨긴 기본 위젯을
  // 우선순위 대상에서 제외하기 위한 ref.
  const hiddenDefaultKeysRef = useRef(hiddenDefaultKeys);
  useEffect(() => {
    hiddenDefaultKeysRef.current = hiddenDefaultKeys;
  }, [hiddenDefaultKeys]);

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
  // PR (probing-custom-widget-priority-weight): 이번 think 호출의 위젯 alias →
  // 라벨 매핑. EMIT 의 target_section alias 를 popup 뱃지 라벨로 되돌린다.
  const widgetAliasLabelRef = useRef<Map<string, string>>(new Map());
  // 주입(one-shot) think 는 자동 think 와 동시 실행될 수 있어 별도 abort ref.
  const injectAbortRef = useRef<AbortController | null>(null);

  const [activePopup, setActivePopup] = useState<PopupQuestion | null>(null);
  const [history, setHistory] = useState<HistoryQuestion[]>([]);

  // ─── 페르소나 export — 세션 시작 시점 추적 + confirm modal + busy flag ───
  // sessionStartedAt: 라이브 진입 시 한 번 set, 종료 시 docx 메타 (인터뷰 일시 /
  // 인터뷰 길이) 로 사용. 새 세션 시작 시 리셋.
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  // 좌 페르소나 grid DOM — PDF 캡쳐 대상 (PR: probing-pdf-export-persona-only).
  // 우패널 (질문 / 사고 흐름) · 서브헤더 · 모달 헤더는 캡쳐 범위 밖.
  const personaGridRef = useRef<HTMLDivElement | null>(null);

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
        await fetchWithAuth('/api/probing/questions', {
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

  // think route 응답 (NDJSON-like 라인 스트림) 을 줄 단위로 dispatch.
  // THINK → 사고 흐름 append, EMIT → popup queue. 자동 think 와 주입 both 사용.
  const consumeThinkStream = useCallback(
    async (body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // THINK / EMIT prefix 외 라인은 무시 (LLM 룰 위반 시 silent drop).
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
          const popup = parseEmit(raw, (alias) =>
            widgetAliasLabelRef.current.get(alias),
          );
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
      const tail = buffer.trim();
      if (tail.length > 0) dispatchLine(tail);
    },
    [handleEmit],
  );

  // ─── think route SSE consumer ───
  // injectedQuestions 비어 있으면 = 자동/수동 think (transcript 변경 트리거).
  // 채워져 있으면 = 사용자가 "주입" 버튼으로 밀어 넣은 one-shot — 이번 호출에만
  // 실리고 다음 자동 think 엔 안 실린다 (갱신과 무관). 주입은 명시적 사용자
  // 행동이라 자동 think inFlight 가드를 우회하고 별도 abort ref 로 동시 실행한다.
  const runThink = useCallback(
    async (injectedQuestions: string[] = []) => {
      const isInjection = injectedQuestions.length > 0;
      if (!isInjection && thinkInFlightRef.current) return;
      const segs = rawSegmentsRef.current;
      const fullText = segmentsText(segs);
      // 주입도 transcript 가 없으면 AI 호출은 skip (좌 위젯은 이미 생성됨).
      if (fullText.length < MIN_TRANSCRIPT_CHARS) return;
      const transcript =
        fullText.length > THINK_MAX_CHARS
          ? fullText.slice(fullText.length - THINK_MAX_CHARS)
          : fullText;

      if (!isInjection) thinkInFlightRef.current = true;
      setThinkingStreaming(true);
      setThinkingError(null);
      const controller = new AbortController();
      if (isInjection) injectAbortRef.current = controller;
      else thinkAbortRef.current = controller;

      // PR (probing-custom-widget-priority-weight): 위젯 채움 상태 스냅샷 —
      // 숨기지 않은 기본 8 (weight 0.5) + custom (weight 1.0). custom 은 짧은
      // ordinal alias (custom_N), 기본은 semantic key 를 alias 로 사용해 LLM 이
      // target_section 으로 되돌려 참조 가능. fill_rate 는 현재 reflection 결과
      // 에서 계산. reflection 아직 없으면 전부 0 (empty) → custom 최우선.
      const refl = reflectionRef.current as Record<
        string,
        ProbingPersonaSection | undefined
      > | null;
      const aliasToLabel = new Map<string, string>();
      const widgetStatus: ProbingWidgetStatus[] = [];
      const hiddenSet = new Set(hiddenDefaultKeysRef.current);
      for (const def of DEFAULT_PERSONA_SECTIONS) {
        if (hiddenSet.has(def.key)) continue;
        aliasToLabel.set(def.key, def.title);
        widgetStatus.push({
          alias: def.key,
          label: def.title,
          weight: DEFAULT_WEIGHT,
          fill_rate: sectionFillRate(refl?.[def.key]),
          is_custom: false,
        });
      }
      customSectionsRef.current.forEach((c, i) => {
        const alias = `custom_${i + 1}`;
        aliasToLabel.set(alias, c.title);
        widgetStatus.push({
          alias,
          label: c.title,
          weight: CUSTOM_WEIGHT,
          fill_rate: sectionFillRate(refl?.[c.key]),
          is_custom: true,
        });
      });
      widgetAliasLabelRef.current = aliasToLabel;

      try {
        const res = await fetchWithAuth('/api/probing/think', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transcript_window: transcript,
            research_goal: contextRef.current.research_goal,
            hypotheses: contextRef.current.hypotheses,
            key_research_question: contextRef.current.key_research_question,
            output_lang: outputLangRef.current,
            injected_questions: injectedQuestions,
            widget_status: widgetStatus,
            // backfill 후에도 비어 있는 커스텀 위젯 = 채우는 질문 우선 제안.
            priority_sections: Array.from(
              emptyCustomRef.current.values(),
            ).map((s) => ({ title: s.title, description: s.description ?? '' })),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `think_failed_${res.status}`);
        }
        await consumeThinkStream(res.body);
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : 'think_failed';
        setThinkingError(msg);
        toast.push('AI 사고 흐름 실패 — 잠시 후 다시 시도해 주세요', {
          tone: 'warn',
        });
      } finally {
        if (isInjection) {
          injectAbortRef.current = null;
        } else {
          thinkInFlightRef.current = false;
          thinkAbortRef.current = null;
        }
        setThinkingStreaming(false);
      }
    },
    [toast, consumeThinkStream],
  );

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

    // custom 섹션 — 기본 8 뒤에 append 되어 persona LLM 이 함께 채운다.
    // ⚠️ LLM 에는 반드시 **짧은 ordinal alias (custom_1..N)** 로 보낸다.
    // localStorage 원본 key 는 crypto.randomUUID() (36자 opaque) 라 모델이
    // 응답 JSON 의 object key 로 verbatim 재현하지 못해 (자리 뒤섞임 / 누락)
    // custom 패널이 영구히 "단서 부족" 에 머무는 회귀의 root cause 였다
    // (기본 8 은 semantic key 라 정상 재현 → custom 에만 증상). alias→원본
    // key 매핑을 로컬에 들고, 응답을 원본 key 슬롯으로 되돌린다. 요청 시점
    // 스냅샷 — 스트리밍 도중 add/remove 되어도 이번 호출의 key 집합은 고정.
    const customSnapshot = customSectionsRef.current;
    const aliasToKey = new Map<string, string>();
    const requestCustomSections = customSnapshot.map((c, i) => {
      const alias = `custom_${i + 1}`;
      aliasToKey.set(alias, c.key);
      return { key: alias, title: c.title, description: c.description };
    });

    try {
      const res = await fetchWithAuth('/api/probing/reflection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: trimmed,
          interview_guide: '',
          output_lang: outputLangRef.current,
          // 빈 배열이면 서버는 옛 동작 (기본 8만).
          custom_sections: requestCustomSections,
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
        const mergedRec = merged as Record<
          string,
          ProbingPersonaSection | undefined
        >;
        let anyChange = false;
        // 기본 8 key (semantic) + custom alias (custom_1..N). 응답 object 는
        // 이 key 로 인덱싱된다. custom 은 alias→원본 UUID key 로 되돌려 저장
        // 하므로 reflection state / 렌더 (reflection-pane) 는 종전대로 원본
        // key 로 인덱싱된다. 아직 안 채워졌으면 sectionOrNull 이 insufficient
        // 로 떨굼.
        const allKeys: string[] = [
          ...PROBING_PERSONA_SECTION_KEYS,
          ...requestCustomSections.map((c) => c.key),
        ];
        for (const key of allKeys) {
          const sec = obj[key] as Record<string, unknown> | undefined;
          if (!sec || typeof sec !== 'object') continue;
          // alias (custom_N) → 원본 key (UUID). 기본 8 은 alias 없음 → 그대로.
          const canonical = aliasToKey.get(key) ?? key;
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
            mergedRec[canonical] = { summary, signals, confidence };
            anyChange = true;
            // reflection 이 이 커스텀 섹션을 채웠으면 더는 우선 질문 대상 아님.
            emptyCustomRef.current.delete(canonical);
          } else if (!mergedRec[canonical]) {
            mergedRec[canonical] = { summary, signals, confidence };
            anyChange = true;
          }
        }
        const hasAnyKey = Object.keys(mergedRec).some(
          (k) => mergedRec[k] !== undefined,
        );
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
      // 이미 성공한 페르소나가 있으면 (reflectionRef.current), 일시적 빈 응답
      // (empty_reflection) / 네트워크 blip / provider 과부하 를 조용히 흡수하고
      // 기존 페르소나를 유지한다 — reflection 은 주기적으로 재호출되므로 다음
      // tick 이 자연히 재시도한다. 첫 생성(prev 없음) 실패만 사용자에게 노출해
      // 매 blip 마다 "생성 실패" 토스트가 뜨는 회귀를 막는다.
      if (reflectionRef.current) {
        setReflectionStatus('ready');
      } else {
        setReflectionError(msg);
        setReflectionStatus('error');
        toast.push('페르소나 생성 실패 — 잠시 후 다시 시도해 주세요', {
          tone: 'warn',
        });
      }
    } finally {
      reflectionInFlightRef.current = false;
    }
  }, [toast]);

  const runReflectionRef = useRef(runReflection);
  useEffect(() => {
    runReflectionRef.current = runReflection;
  }, [runReflection]);

  // ─── 신규 커스텀 위젯 backfill — 누적 대화를 한 번 재분석 ───
  const runBackfill = useCallback(
    async (sectionKey: string, title: string, description?: string) => {
      const segs = rawSegmentsRef.current;
      const fullText = segmentsText(segs);
      // 대화가 거의 없으면 backfill 자체가 불가 → empty (우선 질문 대상).
      if (fullText.length < MIN_TRANSCRIPT_CHARS) {
        emptyCustomRef.current.set(sectionKey, { title, description });
        showBackfillFeedback({ status: 'empty', count: 0 });
        return;
      }
      const trimmed =
        fullText.length > REFLECTION_MAX_CHARS
          ? fullText.slice(fullText.length - REFLECTION_MAX_CHARS)
          : fullText;
      showBackfillFeedback({ status: 'running', count: 0 });
      try {
        const res = await fetchWithAuth('/api/probing/backfill', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transcript_window: trimmed,
            section: { title, description: description ?? '' },
            output_lang: outputLangRef.current,
          }),
        });
        if (!res.ok) throw new Error(`backfill_failed_${res.status}`);
        const json = (await res.json()) as {
          backfilled?: boolean;
          count?: number;
          section?: ProbingPersonaSection;
        };
        if (json.backfilled && json.section) {
          const filled = json.section;
          // 원본 UUID key 슬롯에 병합 — 좌패널이 바로 채워진다. reflection 의
          // merge 는 새 응답이 빈 값일 때 기존 값을 지우지 않으므로 이후 tick
          // 이 이 backfill 결과를 덮어쓰지 않는다.
          setReflection((prev) => {
            const next = { ...(prev ?? {}) } as Record<
              string,
              ProbingPersonaSection | undefined
            >;
            next[sectionKey] = filled;
            return next as ProbingReflectionData;
          });
          setReflectionLastUpdatedAt(Date.now());
          setReflectionStatus('ready');
          emptyCustomRef.current.delete(sectionKey);
          showBackfillFeedback({
            status: 'backfilled',
            count: json.count ?? filled.signals.length,
          });
        } else {
          emptyCustomRef.current.set(sectionKey, { title, description });
          showBackfillFeedback({ status: 'empty', count: 0 });
        }
      } catch {
        // 실패 = 회귀 방지 위해 옛 flow 그대로 (위젯은 이미 생성됨). empty 로
        // 단정하지 않는다 — 다음 reflection tick 이 자연히 채울 수 있다.
        showBackfillFeedback(null);
      }
    },
    [showBackfillFeedback],
  );
  const runBackfillRef = useRef(runBackfill);
  useEffect(() => {
    runBackfillRef.current = runBackfill;
  }, [runBackfill]);

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
      setReflection(null);
      setReflectionStatus('idle');
      setReflectionLastUpdatedAt(null);
      setReflectionError(null);
      setThinkingEvents([]);
      setThinkingError(null);
      setActivePopup(null);
      setHistory([]);
      emptyCustomRef.current.clear();
      showBackfillFeedback(null);
    }
    prevLiveRef.current = isLive;
  }, [isLive, showBackfillFeedback]);

  // 세션 stop 시 진행 중 think SSE abort.
  useEffect(() => {
    if (sessionStatus === 'idle' || sessionStatus === 'stopping') {
      thinkAbortRef.current?.abort();
      injectAbortRef.current?.abort();
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
    trackEvent('job_started', { widget: 'probing', job_type: 'session' });
    await startSession({ source });
  }, [startSession, source]);
  const handleStopSession = useCallback(async () => {
    await stopSession();
  }, [stopSession]);

  // ─── 페르소나 PDF 내보내기 (전체보기 전용) ─────────────────────────
  // 전체보기(fullview) 헤더 버튼에서만 동작한다. 좌 페르소나 grid (기본 8 +
  // custom 섹션) 만 캡쳐해 PDF 로 저장 — 우패널(질문/사고 흐름) · 서브헤더 ·
  // 모달 헤더는 제외. grid 안 "위젯 추가" affordance 는 data-export-hide 로
  // 캡쳐에서 빠진다. 진입 정책: 라이브 중이면 confirm modal (종료 + 내보내기 =
  // 비가역), 비라이브면 확인 없이 즉시 생성.
  const runPdfExport = useCallback(async () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    trackEvent('widget_action', { widget: 'probing', action: 'pdf_export' });
    try {
      if (isLive) {
        try {
          await stopSession();
        } catch {
          // 정지 실패해도 export 자체는 진행 — 사용자 산출물 보존 우선.
        }
      }
      const el = personaGridRef.current;
      if (!el) throw new Error('persona_grid_not_ready');
      const endedAt = new Date();
      const filename = buildPersonaFilename({
        persona: reflectionRef.current,
        endedAt,
      }).replace(/\.docx$/, '.pdf');
      const goal = context.research_goal?.trim();
      await exportDomToPdf(el, filename, {
        hideSelector: '[data-export-hide]',
        columns: 2,
        header: {
          eyebrow: '응답자 페르소나',
          title: goal && goal.length > 0 ? goal : '프로빙 인터뷰',
          subtitle: endedAt.toLocaleString('ko-KR', {
            dateStyle: 'long',
            timeStyle: 'short',
          }),
        },
      });
      toast.push('페르소나 PDF 다운로드됨', { tone: 'info', ttlMs: 2200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'export_failed';
      toast.push(`PDF 내보내기 실패 — ${msg}`, { tone: 'warn' });
    } finally {
      setPdfExporting(false);
    }
  }, [pdfExporting, isLive, stopSession, toast, context.research_goal]);

  const handlePdfExportClick = useCallback(() => {
    if (pdfExporting) return;
    if (isLive) {
      setExportConfirmOpen(true);
      return;
    }
    void runPdfExport();
  }, [pdfExporting, isLive, runPdfExport]);

  const handleExportConfirm = useCallback(() => {
    setExportConfirmOpen(false);
    void runPdfExport();
  }, [runPdfExport]);

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
                : sessionError === 'session_timeout'
                  ? '세션 준비가 지연되고 있습니다 — 잠시 후 다시 시작해 주세요'
                  : sessionError === 'probing_connect_timeout'
                    ? '네트워크 확인 후 다시 시작해 주세요'
                    : '세션 시작 실패 — 잠시 후 다시 시도해 주세요';
    toast.push(human, { tone: 'warn' });
  }, [sessionError, toast]);

  useEffect(() => {
    if (sessionStatus === 'idle') {
      lastSessionErrorRef.current = null;
    }
  }, [sessionStatus]);

  // idle (!isLive) 상태는 status 텍스트를 노출하지 않는다 (null → hint gate).
  // 다른 status (연결/종료/오류/페르소나/사고 흐름/대기 중) 는 유지.
  const statusLabel: string | null = (() => {
    if (sessionStatus === 'starting') return '세션 연결 중…';
    if (sessionStatus === 'stopping') return '세션 종료 중…';
    if (sessionStatus === 'error') return '세션 오류';
    if (!isLive) return null;
    // 30분 cap 재연결 중 — transcript 는 계속 흐르므로 subtle 힌트만.
    if (sessionRenewing) return '🔄 세션 갱신 중…';
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
  // 입력 소스 / 언어 는 세션 진행 중 (idle/error 외) 에는 변경 불가 — 옛 동작.
  const controlsDisabled =
    sessionStatus !== 'idle' && sessionStatus !== 'error';

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

  const customSectionsFull = customSections.length >= CUSTOM_SECTION_MAX;

  // Analytics — custom 위젯(섹션) 추가 계측. add 원본을 감싸 발화 후 위임.
  const handleAddCustomSection = useCallback(
    (...args: Parameters<typeof addCustomSection>) => {
      trackEvent('widget_action', {
        widget: 'probing',
        action: 'custom_section_add',
      });
      return addCustomSection(...args);
    },
    [addCustomSection],
  );

  // 우패널 "주입" 버튼 → 1회 동작 (갱신과 무관). 두 가지를 함께 처리:
  //   (A) 좌패널 grid 에 신규 위젯 생성 — 옛 "+ 새 위젯 추가" 와 같은
  //       addCustomSection 재사용 (질문 = 위젯 title, 기본 8 뒤 append).
  //   (B) AI think 에 one-shot 주입 — injected_questions 로 한 번만 전송해
  //       이번 turn 에 popup 으로 노출. hypotheses 처럼 영구 재주입되지 않음.
  const handleInjectQuestion = useCallback(
    (question: string) => {
      trackEvent('widget_action', {
        widget: 'probing',
        action: 'question_injection',
      });
      const DESC = '즉시 던질 질문';
      const key = addCustomSection(question, DESC);
      // 신규 위젯 = 누적 대화 backfill 시도. 생성 실패(상한 도달)면 skip.
      if (key) void runBackfillRef.current(key, question, DESC);
      void runThinkRef.current([question]);
    },
    [addCustomSection],
  );

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
    customSections,
    onAddCustomSection: handleAddCustomSection,
    onRemoveCustomSection: removeCustomSection,
    customSectionsFull,
    hiddenKeys: hiddenDefaultKeys,
    onHideDefault: hideDefault,
    onRestoreDefault: restoreDefault,
    onRestoreAllDefaults: restoreAllDefaults,
    gridRef: personaGridRef,
  };

  const questionPaneProps = {
    context,
    onContextChange: setContext,
    onInject: handleInjectQuestion,
    backfillFeedback,
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
        {/* 컨트롤 패널 — 서브헤더 slim bar 폐기, phase 무관 항상 노출. CTA 만
            idle→🚀 세션 시작, live→정지 로 전환. starting/stopping/error 는
            isLive=false 로 취급되어 시작 CTA 가 노출돼 재시도 가능. 조사 목적은
            라이브 중에도 편집 가능(goalDisabled=hydration 대기), 소스·언어는
            세션 중 disabled.
            idle(비-라이브·fullview 미open) 에는 컨트롤을 카드 정중앙(수직+수평
            center)에 띄워 다른 위젯과 통일된 launcher 룩. 라이브/전체보기 중에는
            컨트롤을 상단 고정 + 아래 사고흐름/placeholder. */}
        {(() => {
          const controlPanel = (
            <ProbingControlPanel
              researchGoal={context.research_goal}
              onResearchGoalChange={(v) =>
                setContext((prev) => ({ ...prev, research_goal: v }))
              }
              goalDisabled={!contextHydrated}
              source={source}
              onSourceChange={setSource}
              outputLang={outputLang}
              onOutputLangChange={setOutputLang}
              controlsDisabled={controlsDisabled}
              isLive={isLive}
              onStop={handleStopSession}
              stopDisabled={stopDisabled}
              statusLabel={statusLabel}
            />
          );

          // idle — 컨트롤만. (사고흐름/기록 본문은 라이브에서만 의미.)
          // 컨트롤보드 layout = ControlBoardPanel SSOT (px-4 → px-5 정합 포함).
          if (!isLive && !isCurrent) {
            return <ControlBoardPanel>{controlPanel}</ControlBoardPanel>;
          }

          // 라이브 / 전체보기 open — 컨트롤 상단 고정 + 본문(사고흐름 or placeholder).
          return (
            <>
              {controlPanel}
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
            </>
          );
        })()}

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
        {/* 주 CTA(세션 시작) — 바디 최하단 고정 액션 바 (6 위젯 통일). idle
            (비-라이브) 에서만 노출: 라이브 중 정지 CTA 는 컨트롤 패널에 그대로
            유지. */}
        {!isLive && (
          <WidgetPrimaryCta
            label="세션 시작"
            disabled={startDisabled}
            onClick={handleStartSession}
          />
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
          headerAction={
            <>
              {/* 링크로 공유(#477) — 초대 게이트 링크. PDF 내보내기와 구분되는
                  quiet chrome. 컨텍스트가 저장돼야(probingSessionId) 활성화. */}
              <ShareInviteButton
                resourceType="probing_persona"
                resourceId={probingSessionId}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handlePdfExportClick}
                loading={pdfExporting}
                loadingLabel="내보내는 중…"
                title={
                  isLive
                    ? '인터뷰 종료 + 페르소나 PDF 다운로드'
                    : '페르소나 PDF 다운로드'
                }
              >
                {isLive ? '종료 + PDF 내보내기' : 'PDF 내보내기'}
              </Button>
            </>
          }
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
              현재 세션을 정지하고, 응답자 페르소나 그리드(기본 9 + 추가 위젯)를
              PDF 파일로 다운로드합니다. 정지 후에는 이 세션을 다시 이어 받을 수
              없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportCancel}
                disabled={pdfExporting}
              >
                취소
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportConfirm}
                loading={pdfExporting}
                loadingLabel="내보내는 중…"
              >
                종료 + PDF 내보내기
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
      '좌측은 응답자 페르소나 9 패널(기타 포함), 우측은 사용자가 입력한 조사 목적·핵심 가설·KRQ 를 기반으로 AI 가 사고 흐름과 즉시 던질 질문 popup 을 보내줍니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
