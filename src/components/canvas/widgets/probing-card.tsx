'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   세션 lifecycle:
   - "세션 시작" 버튼 → useRealtimeTranscription.start({ source }) → 'live'.
   - 'live' 인 동안: 5초 자동 + 수동 "지금 제안" 트리거.
   - "정지" 버튼 → hook.stop() → 상태 'idle', capture 해제.

   휘발성: 현재 제안 세트는 React state. 페이지 새로고침 / 새 세션
   시작 → 초기화 (의도).

   PR-7 (이 PR) 에서 transcript live preview UI 와 푸터 산출물 히스토리
   영역을 제거. transcript_window 데이터는 그대로 suggest 호출 body 에
   전달 — UI 노출만 사라짐.
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
  ProbingSuggestionSet,
} from './probing-types';

// transcript window — 최근 90초. probing prompt 가 받는 양과 동일.
const PROBING_WINDOW_MS = 90_000;
// 가이드 textarea localStorage 저장 debounce.
const GUIDE_SAVE_DEBOUNCE_MS = 500;
// 자동 호출 간격. 5초 — 빠른 피드백 위해 단축. in-flight 가드 (inFlightRef)
// 가 중복 호출 방지하므로 LLM latency > 5s 여도 안전.
const AUTO_INTERVAL_MS = 5_000;
// transcript 가 의미 있게 모인 뒤에야 호출. 30자 미만이면 skip.
const MIN_TRANSCRIPT_CHARS = 30;

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

  // 90초 윈도우 — LLM 호출이 받는 transcript_window 와 같은 윈도우. UI
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

  // 현재 본문에 표시되는 제안 세트 (stream 진행 중 + 완료 후 직전 세트).
  const [current, setCurrent] = useState<ProbingSuggestionSet | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    // 새 세트의 빈 골격을 먼저 push — partial 동안 본문이 자연스럽게 채워짐.
    const setId = `probing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const started_at = Date.now();
    setCurrent({ id: setId, created_at: started_at, questions: [] });

    try {
      const res = await fetch('/api/probing/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: text,
          interview_guide: guideRef.current,
          max_questions: 3,
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
        const parsed = await parsePartialJson(buffer);
        // 서버 schema 는 questions[*].{text, technique} 가 먼저 emit 되고
        // 그 다음 intents[i] 가 같은 인덱스 순서로 옴. partial 동안 intents
        // 가 아직 비어 있으면 why 는 빈 문자열 — SuggestionList 의 조건부
        // 렌더 (q.why && <p>...) 가 자동으로 의도를 숨김. 모든 질문 핵심이
        // 노출된 다음 intents 가 차례로 채워지면서 사후 입력 효과.
        const obj = parsed.value as
          | {
              questions?: Array<{ text?: string; technique?: string }>;
              intents?: string[];
            }
          | null;
        if (obj && Array.isArray(obj.questions)) {
          const intents = Array.isArray(obj.intents) ? obj.intents : [];
          const clean: ProbingQuestion[] = obj.questions
            .filter((q): q is { text?: string; technique?: string } => !!q)
            .map((q, i) => ({
              text: typeof q.text === 'string' ? q.text : '',
              technique:
                typeof q.technique === 'string' ? q.technique : 'tell_more',
              why: typeof intents[i] === 'string' ? intents[i] : '',
            }))
            .filter((q) => q.text.trim().length > 0);
          setCurrent({ id: setId, created_at: started_at, questions: clean });
        }
      }
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
  }, [toast]);

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

  // 카운트다운 — "다음 자동 제안: N초 후". now 가 1초마다 갱신.
  const secondsToNext =
    isLive && nextCallAt
      ? Math.max(0, Math.ceil((nextCallAt - now) / 1000))
      : null;

  // 상태 라벨 — sessionStatus 와 streaming 상태를 한 줄로 표현.
  const statusLabel = (() => {
    if (sessionStatus === 'starting') return '세션 연결 중…';
    if (sessionStatus === 'stopping') return '세션 종료 중…';
    if (sessionStatus === 'error') return '세션 오류';
    if (!isLive) return '세션 대기';
    if (streaming) return '생성 중…';
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

        {/* 중간 — 제안 카드 영역. flex-1 로 위젯 height 800px 안을 채운다. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* current 가 있으면 카드, 없으면 placeholder. */}
          {current && current.questions.length > 0 ? (
            <SuggestionList set={current} onCopy={handleCopy} streaming={streaming} />
          ) : streaming ? (
            <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
              제안 생성 중…
            </div>
          ) : !isLive ? (
            <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
              상단에서 마이크 또는 탭 오디오를 선택하고 &lsquo;세션 시작&rsquo;을 눌러 주세요.
              <br />
              시작 후 5초마다 후속 질문 3개가 제안됩니다.
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
          )}

          {error && (
            <div className="rounded-xs border border-warning bg-paper px-3 py-2 text-sm text-warning">
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

function SuggestionList({
  set,
  onCopy,
  streaming,
}: {
  set: ProbingSuggestionSet;
  onCopy: (text: string) => void;
  streaming: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
          제안 질문 {set.questions.length}개
        </span>
        <span className="text-xs text-mute-soft">
          {streaming ? '스트리밍…' : '카드 클릭 → 복사'}
        </span>
      </div>
      <ul className="space-y-2">
        {set.questions.map((q, i) => {
          const label =
            q.technique && q.technique in PROBING_TECHNIQUE_LABEL
              ? PROBING_TECHNIQUE_LABEL[q.technique as ProbingTechnique]
              : q.technique || '제안';
          return (
            <li key={i}>
              {/* eslint-disable-next-line react/forbid-elements -- card-shaped clickable. <Button> primitive enforces center-aligned single-line capsule layout incompatible with this multi-row text+chip+why card. */}
              <button
                type="button"
                onClick={() => onCopy(q.text)}
                className="w-full rounded-sm border border-line bg-paper px-4 py-3 text-left transition-colors duration-[120ms] hover:border-amore"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-lg leading-[1.55] text-ink-2">
                    {q.text}
                  </span>
                  <span className="shrink-0 rounded-xs border border-line-soft px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-mute-soft">
                    {label}
                  </span>
                </div>
                {q.why && (
                  <p className="mt-1.5 text-sm leading-[1.6] text-mute">
                    {q.why}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const probingCard: WidgetContent = {
  key: 'probing',
  meta: {
    label: '프로빙 어시스턴트',
    // sky — 분석/컨설팅 톤. 8개 위젯이 6개 accent 색을 공유하는 구조라
    // 재사용 (peach/sun 도 2번씩). translate 의 mint 와 시각 구분.
    accent: 'sky',
    // 호출 단위 비용은 사용자 친화 X — 5초마다 자동 호출되는데 매번 차감하면
    // 사용자가 위젯을 꺼버린다. 옵션 A (무료, 시스템 흡수) 로 시작 — 사용량
    // 폭증 시 후속 PR 에서 세션 단위 부과 (옵션 B) 로 전환.
    cost: 0,
    thumbnail: '/thumbnail/probing.png',
    description: '마이크 또는 탭 오디오 세션에서 후속 질문 3개를 5초마다 제안합니다',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
