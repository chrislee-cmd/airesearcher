'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   PR-1: realtime input transcript 미리보기 + 빈 산출물 영역.
   PR-2: LLM 호출로 후속 질문 (probing) 제안 + 산출물 히스토리.
   PR-4: translate 의존 제거 — 위젯이 자체 OpenAI Realtime transcription
         세션을 들고 transcript 를 받는다. mic-only MVP.
   PR-5: 탭 오디오 지원 — source picker tab 옵션 활성화. hook 에 source
         인자 전달, 에러 코드별 한국어 안내 (probing_timeout / tab_audio_*).

   세션 lifecycle:
   - "세션 시작" 버튼 → useRealtimeTranscription.start({ source }) → 'live'.
   - 'live' 인 동안: 5초 자동 + 수동 "지금 제안" 트리거.
   - "정지" 버튼 → hook.stop() → 상태 'idle', capture 해제.

   휘발성: 모든 제안은 React state. 새 세션 (idle→live) 마다 히스토리
   리셋. 페이지 새로고침 → 모든 데이터 손실 (의도).

   참고: 더이상 RealtimeTranscriptProvider 의 consumer 가 아님.
   provider 는 translate-console 전용으로 유지.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import {
  WidgetOutputRow,
  WidgetOutputs,
} from '@/components/canvas/shell/widget-outputs';
import {
  useRealtimeTranscription,
  type TranscriptionSegment,
} from '@/hooks/use-realtime-transcription';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
} from '@/lib/probing-prompts';
import { ProbingHistoryModal } from '@/components/canvas/modals/probing-history-modal';
import type {
  ProbingQuestion,
  ProbingSuggestionSet,
} from './probing-types';

// transcript window — 최근 90초. probing prompt 가 받는 양과 동일.
const PROBING_WINDOW_MS = 90_000;
// 자동 호출 간격. 5초 — 빠른 피드백 위해 단축. in-flight 가드 (inFlightRef)
// 가 중복 호출 방지하므로 LLM latency > 5s 여도 안전.
const AUTO_INTERVAL_MS = 5_000;
// transcript 가 의미 있게 모인 뒤에야 호출. 30자 미만이면 skip.
const MIN_TRANSCRIPT_CHARS = 30;
// 산출물 영역에 표시할 최대 카운트 — primitive 가 자체적으로 2건 잘라내지만
// 메모리 누수 방지 위해 누적 cap.
const HISTORY_CAP = 50;

// transcript 가 멈춰 있을 때도 cutoff 가 흐르도록 1초마다 강제 리렌더.
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SegmentRow({ seg }: { seg: TranscriptionSegment }) {
  const inFlight = seg.ended_at === undefined;
  return (
    <li
      className={`rounded-xs border px-3 py-2 text-md leading-[1.6] ${
        inFlight
          ? 'border-line-soft bg-paper text-mute'
          : 'border-line bg-paper text-ink-2'
      }`}
    >
      {seg.text}
      {inFlight && <span className="text-mute-soft"> …</span>}
    </li>
  );
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

  const isLive = sessionStatus === 'live';

  // 90초 윈도우 — preview 와 LLM 호출이 같은 윈도우를 본다. hook 의
  // 전체 segments 에서 시간 cutoff 만 적용. now 가 1초마다 갱신되어
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
  const [history, setHistory] = useState<ProbingSuggestionSet[]>([]);
  const [openSet, setOpenSet] = useState<ProbingSuggestionSet | null>(null);
  const [showAll, setShowAll] = useState(false);

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
          interview_guide: '',
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
      let lastQuestions: ProbingQuestion[] = [];
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
          lastQuestions = clean;
          setCurrent({ id: setId, created_at: started_at, questions: clean });
        }
      }

      // 스트림이 끝나면 history 에도 push. 이전 current 가 stream 도중 덮였을
      // 가능성도 있으므로 lastQuestions 를 그대로 사용.
      if (lastQuestions.length > 0) {
        const finalSet: ProbingSuggestionSet = {
          id: setId,
          created_at: started_at,
          questions: lastQuestions,
        };
        setHistory((prev) => {
          const next = [finalSet, ...prev];
          return next.slice(0, HISTORY_CAP);
        });
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

  // 새 세션 시작 시 (isLive false → true 전이) 히스토리 리셋. 같은 세션
  // 안에서 transcript 가 잠시 끊겼다 다시 잡혀도 isLive 가 토글되면 리셋.
  // 스펙: "새 세션이 시작되면 probing 의 제안 히스토리 리셋."
  const prevLiveRef = useRef(false);
  useEffect(() => {
    const prev = prevLiveRef.current;
    if (!prev && isLive) {
      setHistory([]);
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
        </div>

        {/* 중간 — 제안 카드 + transcript 미리보기. flex-1 로 산출물을
            카드 바닥에 고정. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* 제안 카드 영역. current 가 있으면 카드, 없으면 placeholder. */}
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

          {/* transcript 미리보기 — probing 이 어떤 transcript 위에서 제안하는지
              사용자가 한 눈에 확인. */}
          {hasTranscript && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
                  최근 90초 transcript
                </span>
                <span className="text-xs text-mute-soft tabular-nums">
                  {segments.length}개 세그먼트
                </span>
              </div>
              <ul className="space-y-2">
                {segments.map((s) => (
                  <SegmentRow key={s.id} seg={s} />
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 산출물 — probing 제안 히스토리. WidgetOutputs 가 최근 2건 강제,
            초과 시 더보기 모달로 전체 리스트 노출. */}
        <WidgetOutputs
          label="제안 히스토리"
          items={history}
          onMoreClick={() => setShowAll(true)}
          renderItem={(set) => (
            <HistoryRow
              key={set.id}
              set={set}
              onExpand={() => setOpenSet(set)}
            />
          )}
          emptyText="아직 제안된 질문이 없습니다 — 세션 시작 5초 후 첫 제안이 표시됩니다"
        />
      </div>

      <ProbingHistoryModal
        set={openSet}
        onClose={() => setOpenSet(null)}
        onCopy={handleCopy}
      />

      {/* 전체 히스토리 모달 — quotes-card 의 "최근 산출물 (N)" 패턴과 동일. */}
      {showAll && (
        <ProbingAllSetsModal
          history={history}
          onClose={() => setShowAll(false)}
          onExpand={(s) => {
            setShowAll(false);
            setOpenSet(s);
          }}
        />
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

function HistoryRow({
  set,
  onExpand,
}: {
  set: ProbingSuggestionSet;
  onExpand: () => void;
}) {
  const d = new Date(set.created_at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return (
    <WidgetOutputRow
      title={`제안 세트 · ${hh}:${mm}:${ss}`}
      meta={
        <>
          <span>{set.questions.length}개 질문</span>
        </>
      }
      actions={
        <Button
          variant="link"
          size="sm"
          onClick={onExpand}
          className="uppercase tracking-[0.18em]"
        >
          펼치기
        </Button>
      }
    />
  );
}

// 전체 히스토리 모달 — Modal primitive 안에서 history row 를 다시 그린다.
// 단일 set 펼치기 모달 (ProbingHistoryModal) 과 분리한 이유: 두 모달이
// 다른 의도 (목록 vs 단건) 이고 동시에 떠 있을 수 있다.
function ProbingAllSetsModal({
  history,
  onClose,
  onExpand,
}: {
  history: ProbingSuggestionSet[];
  onClose: () => void;
  onExpand: (s: ProbingSuggestionSet) => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`제안 히스토리 (${history.length})`}
      size="lg"
    >
      <ul className="space-y-3">
        {history.map((s) => (
          <HistoryRow key={s.id} set={s} onExpand={() => onExpand(s)} />
        ))}
      </ul>
    </Modal>
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
