'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   세션 lifecycle:
   - "세션 시작" 버튼 → useRealtimeTranscription.start({ source }) → 'live'.
   - 'live' 인 동안: 30초 자동 + 수동 "지금 제안" 트리거.
   - "정지" 버튼 → hook.stop() → 상태 'idle', capture 해제.

   영속화 (PR-8 → PR-12): suggest stream 완료 직후 응답의 각 질문을
   POST /api/probing/questions 로 개별 row 저장 (Promise.all). mount 시
   GET 으로 최근 N개 로드. 새로고침 / 다른 디바이스에서도 같은 user 면
   동일 list. 정렬은 created_at DESC — 최신 상단. 각 질문 옆 ✕ 로 즉시
   삭제 (confirm X — 사용자 명시).

   pause (PR-8): ⏸/▶ 토글로 자동 트리거만 skip. transcript 수집은 계속
   되며 "지금 제안" 수동 버튼은 paused 와 무관 (강제 트리거 가능). 토글
   상태는 in-memory only — 새로고침 시 ▶ default.

   PR-13: 호출 단위를 60초 × 10 질문 묶음 → 5초 × 1 질문 단일로 전환.
   각 질문 행에 ★ 토글이 붙어 핵심 표시 시 핑크 wash highlight.

   PR-14: 5초 × 1q → **30초 × 3q** 로 호흡 확장. transcript window 도
   90초 → 30초 (사용자 명시 — 직전 30초 발화에 집중). PROBING_SYSTEM 이
   why 깊이 / 맥락 hook / sharpness 룰을 우선하도록 재작성됐고, 각 질문에
   `why_sharp` 메타가 붙어 인터뷰어가 sharpness 를 즉시 검증 가능 — UI
   노출은 X, DB row.why 로 영속화 후 사후 검증용. 호출 빈도 -83%
   (12/min → 2/min), 총 token 은 비슷해서 비용은 약간 감소.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import {
  useRealtimeTranscription,
  type TranscriptionSegment,
} from '@/hooks/use-realtime-transcription';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
} from '@/lib/probing-prompts';
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

// transcript window — PR-14: 최근 30초 (사용자 명시). probing prompt 가 받는
// 양과 동일. 90초 → 30초 로 줄여 직전 발화의 구체 단어 / 망설임을 더 정확히
// hook 하도록.
const PROBING_WINDOW_MS = 30_000;
// 가이드 textarea localStorage 저장 debounce.
const GUIDE_SAVE_DEBOUNCE_MS = 500;
// 자동 호출 간격 — PR-14: 5초 → 30초. 5초 × 1q 가 표면적 follow-up 으로
// 흐른다는 사용자 평가에 대응, 호흡을 늘려 sharp 한 3q 묶음을 받는다.
// in-flight 가드 (inFlightRef) 가 중복 호출 방지하므로 LLM latency > 30s
// 여도 안전.
const AUTO_INTERVAL_MS = 30_000;
// 한 호출당 받을 질문 수 — PR-14: 1 → 3. 30초 윈도우에서 다른 angle 의
// 날카로운 follow-up 3개를 묶음으로 받는다.
const QUESTIONS_PER_CALL = 3;
// transcript 가 의미 있게 모인 뒤에야 호출. 30자 미만이면 skip.
const MIN_TRANSCRIPT_CHARS = 30;
// 위젯에 표시할 / fetch 할 최근 질문 갯수. PR-12 에서 set 묶음 → 개별 질문
// 단위로 전환했으므로 (이전 10 set ≈ 100 질문이 가능했음) 50 으로 상향.
// 무한 스크롤 / "더 불러오기" 는 후속 PR.
const DISPLAY_LIMIT = 50;

// transcript 가 멈춰 있을 때도 cutoff 가 흐르도록 1초마다 강제 리렌더.
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function windowText(segments: TranscriptionSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n');
}

// PR-5: source picker — mic / tab 둘 다 활성. tab 선택 시 hook 이
// getDisplayMedia 로 Chrome 의 탭 picker 를 띄운다. radio 두 개를 직접
// 그리지 않고 Button primitive 의 selected/unselected 시각 차이를 흉내내는
// segmented control — design-system 토큰만 사용.
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
    <div className="flex items-center gap-1 rounded-xs border border-line-soft bg-paper p-0.5">
      <Button
        variant={value === 'mic' ? 'primary' : 'ghost'}
        size="xs"
        onClick={() => onChange('mic')}
        disabled={disabled}
        className="uppercase tracking-[0.18em]"
      >
        마이크
      </Button>
      <Button
        variant={value === 'tab' ? 'primary' : 'ghost'}
        size="xs"
        onClick={() => onChange('tab')}
        disabled={disabled}
        className="uppercase tracking-[0.18em]"
      >
        탭 오디오
      </Button>
    </div>
  );
}

// 가이드 collapsible — chevron + "가이드 추가" / "가이드 (N자)" 라벨.
// 펼친 상태에서 Textarea primitive + "파일 가져오기" 버튼 노출. max-h +
// overflow-y-auto 로 위젯 height 800px 안에서 자연스럽게 (3~5줄 정도).
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
            rows={4}
            maxLength={GUIDE_MAX_CHARS}
            placeholder="조사 목적 / 핵심 가설 / 질문 의도 등을 자유롭게 입력하세요. 비워두면 transcript 만 보고 제안합니다."
            helper={`${count.toLocaleString()} / ${GUIDE_MAX_CHARS.toLocaleString()}자  ·  .md / .txt / .docx 가져오기 지원`}
            className="max-h-32 text-md resize-none"
          />
        </>
      )}
    </div>
  );
}

function ExpandedBody() {
  const toast = useToast();
  const now = useNowTick();

  // PR-4: standalone session. translate isLive 의존 제거.
  const {
    status: sessionStatus,
    segments: rawSegments,
    error: sessionError,
    start: startSession,
    stop: stopSession,
  } = useRealtimeTranscription({ locale: 'ko' });

  // source picker — mic / tab. 세션 시작 시 hook 의 start({ source }) 로 전달.
  const [source, setSource] = useState<SourceKind>('mic');

  // 가이드 textarea — 사용자가 자유롭게 쓰는 한 덩어리. localStorage 영속화.
  // mount 시 1회 read, change 시 500ms debounce 로 save.
  const [guide, setGuide] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  // 파일 import 상태 (PR-6b). importing: 파싱 중 / 토스트 미정 구간 비활성화.
  // pendingFile: 기존 가이드 비어있지 않을 때 confirm 다이얼로그를 띄우기
  // 위해 잠시 들고 있는 File.
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
  // suggest 콜백이 stale closure 없이 최신 guide 를 보도록 ref 동기화.
  const guideRef = useRef(guide);
  useEffect(() => {
    guideRef.current = guide;
  }, [guide]);

  const isLive = sessionStatus === 'live';

  // 30초 윈도우 — LLM 호출이 받는 transcript_window 와 같은 윈도우. UI
  // 에서는 hasTranscript 만 사용 (제안 카드 empty state + 수동 트리거 가드).
  // hook 의 전체 segments 에서 시간 cutoff 만 적용. now 가 1초마다 갱신되어
  // 세션이 idle 인 동안에도 cutoff 가 흘러간다.
  const segments = useMemo(
    () => {
      const cutoff = now - PROBING_WINDOW_MS;
      return rawSegments.filter((s) => s.started_at >= cutoff);
    },
    [rawSegments, now],
  );
  const hasTranscript = segments.length > 0;

  // stream 진행 중인 단일 set — 완료되면 POST 응답으로 받은 row 로
  // suggestions 에 prepend 되고 current 는 다시 null.
  const [current, setCurrent] = useState<ProbingSuggestionSet | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PR-12: DB 영속화된 누적 list — 개별 질문 단위 (한 row = 한 질문).
  // mount 시 GET 으로 채우고 새 stream 완료 후 prepend (N 질문 → N row).
  // 표시 상한 DISPLAY_LIMIT.
  const [questions, setQuestions] = useState<ProbingQuestionRow[]>([]);
  // 첫 GET 응답을 기다리는 동안엔 빈 empty state 대신 hydrating 힌트.
  const [hydrating, setHydrating] = useState(true);
  // PR-11/12: 전체 list 단일 selection. id 가 선택되면 다른 row 들이 dim.
  // null = 모두 정상. 같은 row 재클릭 → toggle off, 다른 row → switch.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 자동 트리거 일시 정지 토글. in-memory only (세션 단위) — 새로고침 시
  // false default. setInterval 안에서 stale closure 없이 보도록 ref 동기화.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // 자동 타이머가 "다음 호출까지 남은 시간" 을 표시하기 위해 next-call epoch
  // 를 ref + state 양쪽에 보관. ref 는 setInterval/setTimeout 안에서 stale
  // closure 방지용, state 는 카운트다운 렌더 트리거.
  const [nextCallAt, setNextCallAt] = useState<number | null>(null);

  // in-flight 호출 중복 방지. 자동 + 수동 모두 inFlightRef 가 true 면 skip.
  const inFlightRef = useRef(false);

  // segments 의 최신값을 콜백 안에서 stale 없이 보기 위한 ref. setInterval
  // 안에서 React 의 useState 를 closure 로 잡으면 직전 값을 들고 호출됨.
  const rawSegmentsRef = useRef(rawSegments);
  useEffect(() => {
    rawSegmentsRef.current = rawSegments;
  }, [rawSegments]);

  // mount 시 1회 — 최근 N개 DB row 를 가져와 list 초기화. 실패해도 새 stream
  // 은 가능하므로 silent (토스트 X).
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

  // PR-12: stream 완료된 N 질문을 개별 row 로 DB 영속화. 응답을 받으면
  // questions 의 맨 앞에 prepend. POST 실패 시에도 사용자가 결과를 잃지
  // 않도록 in-memory row 로 fallback prepend — 다음 새로고침 때 사라지는
  // 게 유일한 차이.
  //
  // N 호출은 Promise.allSettled — 일부 실패해도 성공한 row 는 보존하고
  // 실패분만 fallback in-memory row 로 채운다. created_at 은 같은 stream
  // 안의 순서를 보존하기 위해 idx ms offset 적용.
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
          // 1ms 씩 offset 으로 stream 안 순서 보존 (정렬 desc 시 위에서 i=0).
          // 'local-' prefix 라 server UUID 와 겹치지 않음.
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
      // 같은 stream 이 여전히 current 일 때만 비운다 — 사용자가 그 사이에
      // 또 트리거 했으면 새 stream 을 가리키므로 건드리면 안 됨.
      setCurrent((cur) => (cur?.id === streamingId ? null : cur));
    },
    [],
  );

  const runSuggest = useCallback(async () => {
    if (inFlightRef.current) return;
    const cutoff = Date.now() - PROBING_WINDOW_MS;
    const segs = rawSegmentsRef.current.filter(
      (s) => s.started_at >= cutoff,
    );
    const text = windowText(segs);
    if (text.length < MIN_TRANSCRIPT_CHARS) {
      // 의미 없는 호출 방지 — 자동 호출 시 transcript 가 빈약하면 skip.
      // 다음 자동 호출은 정상 시도되도록 inFlight 는 건드리지 않는다.
      return;
    }

    inFlightRef.current = true;
    setStreaming(true);
    setError(null);

    // 빈 골격은 push 하지 않는다 — stream 동안엔 카드가 안 보이고 (헤더
    // 의 statusLabel 이 "생성 중…" 으로 피드백), 응답이 완성되면 한 번에
    // setCurrent(full) 로 카드가 일괄 표시된다. partial 한 글자씩 채움
    // 효과는 의도적으로 제거 — 사용자 요청.
    const setId = `probing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const started_at = Date.now();

    // stream 종료 시점에 잡힌 최종 questions. POST persist 에 사용.
    let finalQuestions: ProbingQuestion[] = [];
    let succeeded = false;

    try {
      const res = await fetch('/api/probing/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: text,
          interview_guide: guideRef.current,
          // PR-14: 30초 주기 3 질문 묶음. LLM 이 직전 30초 발화를 보고
          // why 깊이 / 맥락 hook / sharpness 룰에 맞춰 3개 angle 을 만들어
          // 반환한다.
          max_questions: QUESTIONS_PER_CALL,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `suggest_failed_${res.status}`);
      }
      // 전체 응답을 다 받은 뒤 한 번만 파싱. partial JSON 헬퍼는 그대로
      // 사용 — 서버가 trailing whitespace / 누락 닫힘 으로 끝낼 수 있어도
      // 너그럽게 받아준다.
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
            // PR-14: UI 는 의도 서브 텍스트를 더 이상 표시하지 않지만,
            // 모델이 반환한 why_sharp (어느 발화 신호를 hook 했는지) 를
            // DB row.why 로 저장해 인터뷰어 / 워커가 사후 검증할 수 있게
            // 한다. 없으면 빈 문자열.
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
      setError(msg);
      toast.push('제안 생성 실패 — 다음 자동 호출에서 다시 시도합니다', {
        tone: 'warn',
      });
      // 실패한 세트는 본문에서 치운다 — 사용자가 빈 카드 더미를 보지 않게.
      setCurrent(null);
    } finally {
      inFlightRef.current = false;
      setStreaming(false);
    }

    // stream 정상 종료 + 질문이 1개 이상 잡혔으면 DB 영속화. fire-and-
    // forget — persistQuestions 가 fallback in-memory row 까지 처리한다.
    if (succeeded && finalQuestions.length > 0) {
      void persistQuestions(setId, finalQuestions, text);
    }
  }, [persistQuestions, toast]);

  // 자동 타이머. isLive 가 true → AUTO_INTERVAL_MS 후 첫 호출, 이후 같은 주기.
  // isLive 가 false 가 되면 타이머 stop + nextCallAt 초기화.
  useEffect(() => {
    if (!isLive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on isLive transition to false
      setNextCallAt(null);
      return;
    }
    // isLive 전이 직후 다음 호출 시각 = 지금 + AUTO_INTERVAL_MS.
    setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
    const id = setInterval(() => {
      // pause 토글이 켜져 있으면 자동 호출만 skip. transcript 수집과
      // 카운트다운 ref 는 그대로 — ▶ 누르면 곧장 다음 주기에 재개.
      if (pausedRef.current) {
        setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
        return;
      }
      void runSuggest();
      setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isLive, runSuggest]);

  // 새 세션 시작 시 (isLive false → true 전이) 현재 제안 / 에러 리셋.
  // 같은 세션 안에서 transcript 가 잠시 끊겼다 다시 잡혀도 isLive 가 토글되면
  // 리셋.
  const prevLiveRef = useRef(false);
  useEffect(() => {
    const prev = prevLiveRef.current;
    if (!prev && isLive) {
      setCurrent(null);
      setError(null);
    }
    prevLiveRef.current = isLive;
  }, [isLive]);

  // "지금 제안" 수동 버튼. 자동 타이머 reset — 다음 자동 호출은 지금 + AUTO_INTERVAL_MS.
  function handleManual() {
    if (inFlightRef.current) return;
    setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
    void runSuggest();
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push('복사됨', { tone: 'info', ttlMs: 1800 });
    } catch {
      toast.push('복사 실패 — 직접 선택해서 복사해 주세요', { tone: 'warn' });
    }
  }

  // PR-13: ★ 클릭 → is_core toggle. 즉시 UI 갱신 (optimistic) + PATCH 호출.
  // 'local-' prefix 는 server 에 없으므로 in-memory 만 토글. PATCH 실패 시
  // 토스트 + 직전 값으로 롤백.
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
        // 실패 — 직전 값으로 롤백.
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

  // PR-12: ✕ 클릭 → 즉시 UI 제거 (optimistic) + DELETE 호출. 사용자 명시로
  // confirm / undo 모두 없음. DB 삭제 실패 시 토스트 + 같은 위치 복구.
  // 'local-' prefix 는 in-memory fallback row 라 server 에 없으므로 DELETE
  // 호출 skip — 그냥 state 에서 제거.
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
      // selection 이 삭제된 row 였다면 해제.
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
        // 실패 — 같은 위치로 복구.
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

  // selectedId 가 있을 때만 esc 리스너 — list 전체에 한 번만 붙임.
  useEffect(() => {
    if (selectedId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // 파일 import 실제 파싱 — confirm 통과 후 또는 기존 가이드가 비어있을 때.
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

  // "파일 가져오기" 클릭 — hidden file input trigger.
  function handleImportClick() {
    if (importing) return;
    fileInputRef.current?.click();
  }

  // 파일 선택 후. 기존 가이드가 있으면 confirm; 비어있으면 바로 파싱.
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 선택해도 onChange 가 다시 발화하도록 input 초기화.
    e.target.value = '';
    if (!file) return;
    if (guide.trim().length > 0) {
      setPendingFile(file);
      return;
    }
    void runImport(file);
  }

  // confirm 통과 — pendingFile 파싱.
  function handleConfirmReplace() {
    const file = pendingFile;
    setPendingFile(null);
    if (file) void runImport(file);
  }

  // 세션 시작 / 정지 — hook 호출 + 사용자 친화 에러 메시지.
  const handleStartSession = useCallback(async () => {
    await startSession({ source });
  }, [startSession, source]);

  const handleStopSession = useCallback(async () => {
    await stopSession();
  }, [stopSession]);

  // hook 에서 surface 된 에러를 토스트로 한 번만 보여준다. 같은 에러
  // string 이 다시 들어와도 한 번만 push (소음 방지).
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

  // 세션이 idle 로 돌아가면 lastError ref 도 비워서 다음 시도가 다시
  // 안내될 수 있게.
  useEffect(() => {
    if (sessionStatus === 'idle') {
      lastSessionErrorRef.current = null;
    }
  }, [sessionStatus]);

  // 카운트다운 — "다음 자동 제안: N초 후". now 가 1초마다 갱신. paused
  // 일 땐 null — 라벨이 "자동 일시 정지됨" 으로 대체된다.
  const secondsToNext =
    isLive && !paused && nextCallAt
      ? Math.max(0, Math.ceil((nextCallAt - now) / 1000))
      : null;

  // 상태 라벨 — sessionStatus 와 streaming 상태를 한 줄로 표현.
  const statusLabel = (() => {
    if (sessionStatus === 'starting') return '세션 연결 중…';
    if (sessionStatus === 'stopping') return '세션 종료 중…';
    if (sessionStatus === 'error') return '세션 오류';
    if (!isLive) return '세션 대기';
    if (streaming) return '생성 중…';
    if (paused) return '자동 일시 정지됨';
    if (secondsToNext !== null) return `다음 자동 제안: ${secondsToNext}초 후`;
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

  return (
    <>
      <div className="flex h-full flex-col">
        {/* 상단 — source picker + 세션 시작/정지. */}
        <div className="flex shrink-0 flex-col gap-3 border-b border-line-soft px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <SourcePicker
              value={source}
              onChange={setSource}
              disabled={sessionStatus !== 'idle' && sessionStatus !== 'error'}
            />
            <div className="flex items-center gap-2">
              {isLive ? (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={handleStopSession}
                  disabled={stopDisabled}
                  className="uppercase tracking-[0.18em]"
                >
                  정지
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={handleStartSession}
                  disabled={startDisabled}
                  className="uppercase tracking-[0.18em]"
                >
                  세션 시작
                </Button>
              )}
            </div>
          </div>

          {/* 상태 라인 + 카운트다운 + 수동 트리거. */}
          <div className="flex items-center justify-between">
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
              <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
                {statusLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={paused ? 'primary' : 'ghost'}
                size="xs"
                onClick={() => setPaused((p) => !p)}
                disabled={!isLive}
                aria-pressed={paused}
                aria-label={paused ? '자동 제안 재개' : '자동 제안 일시 정지'}
                leftIcon={
                  paused ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="10"
                      height="10"
                      fill="currentColor"
                      aria-hidden
                    >
                      <polygon points="7 4 20 12 7 20 7 4" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="10"
                      height="10"
                      fill="currentColor"
                      aria-hidden
                    >
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  )
                }
                className="uppercase tracking-[0.18em]"
              >
                {paused ? '재개' : '자동 정지'}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={handleManual}
                disabled={!isLive || streaming || !hasTranscript}
                className="uppercase tracking-[0.18em]"
              >
                지금 제안
              </Button>
            </div>
          </div>

          {/* 가이드 — 사용자가 적어두는 free-form 컨텍스트. 비어 있으면
              backend 가 무시, 채워두면 prompt 에 [인터뷰 가이드 / RQ] 블록
              으로 전달. localStorage 영속화 (key: probing-guide-v1). */}
          <GuideSection
            value={guide}
            onChange={setGuide}
            open={guideOpen}
            onToggle={() => setGuideOpen((o) => !o)}
            onImportClick={handleImportClick}
            importing={importing}
          />
          {/* hidden file picker — Button 이 programmatic 으로 trigger. <Input>
              primitive 는 라벨/helper wrapper 가 강제라 native picker 보다
              무거우므로 여기선 native 유지. (attendees-panel.tsx 와 동일
              패턴 — 단 scheduler 디렉토리는 design-system lint 면제 구역.) */}
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

        {/* 중간 — PR-12: 개별 질문 단위 평면 list (set 묶음 표시 폐기).
            위에서부터 (1) stream 진행 중 transient 질문들 (아직 DB 미반영),
            (2) DB 영속화된 누적 list (sort DESC). 비어 있으면 컨텍스트별
            placeholder. flex-1 로 위젯 height 800px 안을 채운다. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* stream 중 인디케이터 — 이미 history 가 있어 empty placeholder
              로 떨어지지 않을 때만 list 맨 위에 짧게 표시. */}
          {streaming && !current && questions.length > 0 && (
            <div className="mb-3 rounded-xs border border-dashed border-line-soft bg-paper px-3 py-2 text-center text-sm text-mute-soft">
              제안 생성 중…
            </div>
          )}

          {(current && current.questions.length > 0) || questions.length > 0 ? (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
                제안 질문 {(current?.questions.length ?? 0) + questions.length}개
              </span>
              <span className="text-xs text-mute-soft">
                클릭 → 복사 · ★ → 핵심 · ✕ → 삭제
              </span>
            </div>
          ) : null}

          <ul className="divide-y divide-line-soft">
            {/* 진행 중 stream 의 질문들 — 아직 DB 미반영이라 ✕ / ★ 미노출
                (id 가 아직 없음). */}
            {current?.questions.map((q, i) => (
              <QuestionRow
                key={`stream-${current.id}-${i}`}
                text={q.text}
                technique={q.technique}
                createdAtMs={current.created_at}
                nowMs={now}
                isSelected={false}
                isDimmed={selectedId !== null}
                isCore={false}
                onClick={() => {
                  void handleCopy(q.text);
                }}
                onToggleCore={null}
                onDelete={null}
              />
            ))}

            {questions.map((row) => {
              const isSelected = selectedId === row.id;
              const isDimmed = selectedId !== null && !isSelected;
              return (
                <QuestionRow
                  key={row.id}
                  text={row.text}
                  technique={row.technique}
                  createdAtMs={Date.parse(row.created_at)}
                  nowMs={now}
                  isSelected={isSelected}
                  isDimmed={isDimmed}
                  isCore={row.is_core}
                  onClick={() => {
                    void handleCopy(row.text);
                    setSelectedId((prev) => (prev === row.id ? null : row.id));
                  }}
                  onToggleCore={() => {
                    void handleToggleCore(row.id);
                  }}
                  onDelete={() => {
                    void handleDelete(row.id);
                  }}
                />
              );
            })}
          </ul>

          {/* placeholder — 영속화 list 도 비어 있고 stream 도 없을 때만. */}
          {!current && questions.length === 0 && (
            hydrating ? (
              <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
                저장된 제안 불러오는 중…
              </div>
            ) : streaming ? (
              <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
                제안 생성 중…
              </div>
            ) : !isLive ? (
              <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
                상단에서 마이크 또는 탭 오디오를 선택하고 &lsquo;세션 시작&rsquo;을 눌러 주세요.
                <br />
                시작 후 30초마다 직전 발화에 맞춘 날카로운 후속 질문 3개가 제안됩니다.
                {source === 'tab' && (
                  <>
                    <br />
                    <span className="mt-1 inline-block text-xs text-mute-soft">
                      탭 오디오는 공유한 탭에서 <strong>재생되는 소리</strong>만 캡처합니다 (본인 마이크 발화 제외). Zoom 은 zoom.us/wc 웹클라이언트 탭을 공유해야 다른 참가자 발언을 캡처할 수 있습니다.
                    </span>
                  </>
                )}
              </div>
            ) : !hasTranscript ? (
              <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
                transcript 가 들어오면 첫 제안이 표시됩니다.
              </div>
            ) : (
              <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
                첫 자동 제안까지 대기 중. &lsquo;지금 제안&rsquo; 으로 즉시 시도할 수 있어요.
              </div>
            )
          )}

          {error && (
            <div className="mt-3 rounded-xs border border-warning bg-paper px-3 py-2 text-sm text-warning">
              제안 생성 실패: {error}
            </div>
          )}
        </div>
      </div>

      {/* 파일 import — 기존 가이드 비어있지 않을 때 교체 confirm.
          확인 시 runImport, 취소 시 pendingFile drop. */}
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

// 한국어 상대 시간 — "방금 전 / N분 전 / N시간 전 / N일 전". 위젯 안에서만
// 쓰이는 보조라 외부 i18n 헬퍼는 과함. nowMs 가 1초마다 갱신되어 라벨이
// 자연스럽게 흘러간다.
function formatRelativeKo(epochMs: number, nowMs: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return '방금 전';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

// PR-12/13/15: 개별 질문 한 줄 — 평면 list 의 한 row.
// - 클릭: 복사 + selection toggle (PR-11 dim 효과).
// - 우측: ★ (핵심 토글) + ✕ (삭제) 묶음. 둘 다 transient stream row 에는
//   미노출 (id 미정).
// - PR-15: 두 버튼은 한 flex 컨테이너 안 묶음 + Memphis 톤 (32px · 검정 border
//   2px · offset shadow · hover translate). 항상 visible — 헤더 가이드 텍스트
//   "★ → 핵심 · ✕ → 삭제" 가 의미를 고정하므로 hover-only 가 오히려 혼란.
// - isCore = true 면 행 전체에 rose wash + thicker rose border. dim 상태에서
//   다른 row 가 어두워질 때도 핵심 표시는 유지된다 (시각 우선순위: 핵심 > dim).
function QuestionRow({
  text,
  technique,
  createdAtMs,
  nowMs,
  isSelected,
  isDimmed,
  isCore,
  onClick,
  onToggleCore,
  onDelete,
}: {
  text: string;
  technique: string;
  createdAtMs: number;
  nowMs: number;
  isSelected: boolean;
  isDimmed: boolean;
  isCore: boolean;
  onClick: () => void;
  onToggleCore: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const label =
    technique && technique in PROBING_TECHNIQUE_LABEL
      ? PROBING_TECHNIQUE_LABEL[technique as ProbingTechnique]
      : technique || '제안';
  const rel = formatRelativeKo(createdAtMs, nowMs);
  // 핵심 highlight 우선 — dim 상태에서도 살짝 보존되어 인터뷰어가 흐름을
  // 잃지 않도록 (60% > 일반 dim 의 40%). 핵심 + selected 면 정상 opacity.
  const wrapperOpacity = isDimmed ? (isCore ? 'opacity-60' : 'opacity-40') : '';
  // 핵심 행: rose wash + thicker rose border. 일반 행: invisible border 로
  // 자리만 점유 (highlight 토글 시 layout 안 흔들리도록).
  const coreClasses = isCore
    ? 'bg-rose/30 border-l-2 border-rose'
    : 'border-l-2 border-transparent';
  const hasActions = Boolean(onToggleCore || onDelete);
  // Memphis 액션 버튼 — D5 카드 톤 정합. 32×32 · 검정 2px border · 2px offset
  // shadow · 호버 시 translate+shadow 축소, active 시 shadow 사라짐. 토큰화된
  // canvas-card-border 변수를 직접 참조해 D5 와 변경이 묶이도록.
  const actionButtonBase =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-[2px] border-[var(--canvas-card-border)] shadow-[2px_2px_0_var(--canvas-card-border)] transition-[transform,box-shadow,background-color,color] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_var(--canvas-card-border)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--canvas-accent)]';
  return (
    <li
      className={`group flex items-start gap-3 rounded-xs px-2 py-2 transition duration-200 ${coreClasses} ${wrapperOpacity}`}
    >
      {/* eslint-disable-next-line react/forbid-elements -- inline-text clickable row. <Button> primitive enforces capsule shape incompatible with full-width left-aligned text row. */}
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onClick}
        className="min-w-0 flex-1 text-left text-md leading-[1.55] text-ink-2 transition duration-200 hover:text-amore"
      >
        <span className="mr-2 text-xs uppercase tracking-[0.18em] text-mute-soft">
          {label}
        </span>
        {text}
        {rel && (
          <span className="ml-2 text-xs text-mute-soft">· {rel}</span>
        )}
      </button>
      {hasActions && (
        <div className="flex shrink-0 items-center gap-1.5 pr-1 pt-0.5">
          {onToggleCore && (
            // eslint-disable-next-line react/forbid-elements -- Memphis-styled action button group inside list row; <IconButton> primitive doesn't expose the canvas-card Memphis chrome (offset shadow + translate-on-press) needed for D5 톤 정합.
            <button
              type="button"
              aria-label={isCore ? '핵심 표시 해제' : '핵심으로 표시'}
              aria-pressed={isCore}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCore();
              }}
              className={`${actionButtonBase} ${
                isCore
                  ? 'bg-[var(--canvas-accent)] text-white'
                  : 'bg-white text-ink'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill={isCore ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
          {onDelete && (
            // eslint-disable-next-line react/forbid-elements -- Memphis-styled action button group inside list row; <IconButton> primitive doesn't expose the canvas-card Memphis chrome (offset shadow + translate-on-press) needed for D5 톤 정합.
            <button
              type="button"
              aria-label="이 제안 삭제"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={`${actionButtonBase} bg-white text-ink`}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export const probingCard: WidgetContent = {
  key: 'probing',
  meta: {
    label: '프로빙 어시스턴트',
    // sky — 분석/컨설팅 톤. 8개 위젯이 6개 accent 색을 공유하는 구조라
    // 재사용 (peach/sun 도 2번씩). translate 의 mint 와 시각 구분.
    accent: 'sky',
    // 호출 단위 비용은 사용자 친화 X — 30초마다 자동 호출되는데 매번 차감하면
    // 사용자가 위젯을 꺼버린다. 옵션 A (무료, 시스템 흡수) 로 시작 — 사용량
    // 폭증 시 후속 PR 에서 세션 단위 부과 (옵션 B) 로 전환.
    cost: 0,
    thumbnail: '/thumbnail/probing.png',
    description: '마이크 또는 탭 오디오 세션에서 30초마다 직전 발화에 맞춘 날카로운 후속 질문을 3개씩 제안합니다',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
