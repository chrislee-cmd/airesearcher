'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   PR-1: realtime input transcript 미리보기 + 빈 산출물 영역.
   PR-2: LLM 호출로 후속 질문 (probing) 제안 + 산출물 히스토리.

   트리거:
   - 자동: translate isLive 가 true 가 된 시점부터 60초 후 첫 호출,
     이후 매 60초. translate 가 stop 되면 타이머 stop.
   - 수동: "지금 제안" 버튼 — 자동 타이머 reset 하고 즉시 호출.

   휘발성: 모든 제안은 React state. translate 가 새로 시작 (false→true)
   되면 히스토리 리셋. 페이지 새로고침 → 모든 데이터 손실 (의도).

   provider 가 mount 안 되어 있어도 hook 이 빈 stub 을 반환하므로 안전.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import {
  WidgetOutputRow,
  WidgetOutputs,
} from '@/components/canvas/shell/widget-outputs';
import {
  useRealtimeTranscript,
  type TranscriptSegment,
} from '@/components/realtime-transcript-provider';
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
// 자동 호출 간격. 60초 = SSOT 스펙.
const AUTO_INTERVAL_MS = 60_000;
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

function SegmentRow({ seg }: { seg: TranscriptSegment }) {
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

function windowText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n');
}

function ExpandedBody() {
  const { isLive, recent } = useRealtimeTranscript();
  const toast = useToast();
  const now = useNowTick();

  // 90초 윈도우 — preview 와 LLM 호출이 같은 윈도우를 본다.
  const segments = useMemo(
    () => recent(PROBING_WINDOW_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- now 가 시간 흐름 트리거
    [recent, now],
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

  // segments 의 최신값을 콜백 안에서 stale 없이 보기 위한 ref. setTimeout
  // 안에서 React 의 useState segments 를 closure 로 잡으면 60초 전 값을
  // 들고 호출됨.
  const recentRef = useRef(recent);
  useEffect(() => {
    recentRef.current = recent;
  }, [recent]);

  const runSuggest = useCallback(async () => {
    if (inFlightRef.current) return;
    const segs = recentRef.current(PROBING_WINDOW_MS);
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
          max_questions: 4,
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
        const obj = parsed.value as
          | { questions?: Array<Partial<ProbingQuestion>> }
          | null;
        if (obj && Array.isArray(obj.questions)) {
          // partial 동안에는 text / technique / why 가 누락된 항목이 섞일 수
          // 있다. text 가 비어 있으면 아직 표시 X — UI 가 빈 카드를 그리지 않게.
          const clean: ProbingQuestion[] = obj.questions
            .filter((q): q is Partial<ProbingQuestion> => !!q)
            .map((q) => ({
              text: typeof q.text === 'string' ? q.text : '',
              technique:
                typeof q.technique === 'string' ? q.technique : 'tell_more',
              why: typeof q.why === 'string' ? q.why : '',
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

  // 자동 타이머. isLive 가 true → 60초 후 첫 호출, 이후 60초마다. isLive
  // 가 false 가 되면 타이머 stop + nextCallAt 초기화.
  useEffect(() => {
    if (!isLive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on isLive transition to false
      setNextCallAt(null);
      return;
    }
    // isLive 전이 직후 다음 호출 시각 = 지금 + 60초.
    setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
    const id = setInterval(() => {
      void runSuggest();
      setNextCallAt(Date.now() + AUTO_INTERVAL_MS);
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isLive, runSuggest]);

  // 새 세션 시작 시 (isLive false → true 전이) 히스토리 리셋. 같은 세션
  // 안에서 transcript 가 잠시 끊겼다 다시 잡혀도 isLive 가 토글되면 리셋.
  // 스펙: "translate 가 새로 시작 되면 probing 의 제안 히스토리 리셋."
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

  // "지금 제안" 수동 버튼. 자동 타이머 reset — 다음 자동 호출은 지금 +60초.
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

  // 카운트다운 — "다음 자동 제안: N초 후". now 가 1초마다 갱신.
  const secondsToNext =
    isLive && nextCallAt
      ? Math.max(0, Math.ceil((nextCallAt - now) / 1000))
      : null;

  return (
    <>
      <div className="flex h-full flex-col">
        {/* 상단 — live 상태 + 카운트다운 + 수동 버튼. */}
        <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isLive ? 'bg-amore' : 'bg-line'
              }`}
              aria-hidden
            />
            <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
              {!isLive
                ? '통역 대기 중'
                : streaming
                ? '생성 중…'
                : secondsToNext !== null
                ? `다음 자동 제안: ${secondsToNext}초 후`
                : '대기 중'}
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
              실시간 통역(translate) 위젯을 먼저 시작해 주세요.
              <br />
              시작 후 60초마다 후속 질문이 제안됩니다.
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
          emptyText="아직 제안된 질문이 없습니다 — translate 시작 60초 후 첫 제안이 표시됩니다"
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
    // 호출 단위 비용은 사용자 친화 X — 60초마다 자동 호출되는데 매번 차감하면
    // 사용자가 위젯을 꺼버린다. 옵션 A (무료, 시스템 흡수) 로 시작 — 사용량
    // 폭증 시 후속 PR 에서 세션 단위 부과 (옵션 B) 로 전환.
    cost: 0,
    thumbnail: '/thumbnail/probing.png',
    description: '실시간 통역을 듣고 후속 질문 3~5개를 60초마다 제안합니다',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
