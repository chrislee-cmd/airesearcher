'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget.

   PR (probing-question-thinking-flow): 우패널을 4-layer 로 재편 —
     A. 사용자 입력 (조사 목적 / KRQ) — DB 영속화
        (옛 "핵심 가설" 은 은퇴 — probing-hypotheses-retire-ghost-injection)
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
import { useTranslations, useLocale } from 'next-intl';
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
import {
  ShareGuidePopup,
  isShareGuideSuppressed,
} from '@/components/share-guide-popup';
import { useToast } from '@/components/toast-provider';
import { exportDomToPdf } from '@/lib/export/pdf-from-dom';
import { buildPersonaFilename } from '@/lib/probing-persona-docx';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetLiveFullviewPrompt } from '@/components/canvas/shell/widget-live-fullview-prompt';
import {
  useFullview,
  useFullviewChrome,
} from '@/components/canvas/shell/fullview-shell-context';
import {
  FullviewProjectPill,
  FullviewStatusChip,
  FullviewEndSessionButton,
} from '@/components/canvas/fullview/fullview-header';
import { ProbingFullviewBody } from '@/components/canvas/fullview/probing/probing-fullview-body';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { ChromeButton } from '@/components/ui/chrome-button';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { useWidgetGate } from '@/components/widget-gate-provider';
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
import { ProbingSetupAccordion } from './probing/setup-accordion';
import { CUSTOM_SECTION_MAX } from './probing/use-custom-sections';
import { useProbingPersonaConfig } from './probing/use-probing-persona-config';
import { useProjectSelection } from '@/components/project-selection-provider';
import {
  DEFAULT_PERSONA_SECTIONS,
  PROBING_TECHNIQUES,
  PROBING_THINK_IMPORTANCE,
  probingThinkEmitSchema,
  type ProbingChangeType,
  type ProbingOutputLang,
  type ProbingPersonaConflict,
  type ProbingPersonaHistoryEntry,
  type ProbingPersonaSection,
  type ProbingPersonaSignal,
} from '@/lib/probing-prompts';
import {
  CUSTOM_WEIGHT,
  DEFAULT_WEIGHT,
  sectionFillRate,
  type ProbingWidgetStatus,
} from '@/lib/probing-widget-weight';
import {
  PROBING_PERSONA_SNAPSHOT_VERSION,
  type ProbingPersonaSnapshot,
  type ProbingPersonaSnapshotPanel,
  type ProbingPersonaSnapshotQuestion,
} from '@/lib/probing-persona-snapshot';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import {
  probingLiveChannelName,
  PROBING_LIVE_PERSONA_EVENT,
  PROBING_LIVE_THINK_EVENT,
  PROBING_LIVE_INJECT_EVENT,
  probingLiveInjectSchema,
} from '@/lib/probing/live-channel';
import { ProbingEmitGuard } from '@/lib/probing/emit-guard';

// 세션 원본 녹음(#554/#582) 실패 사유 코드 → 사람이 읽을 안내. empty/error 표면
// 노티스에서 "왜 다운로드가 없는지" 를 사용자에게 알려주는 매핑. 세션 종료는
// 이미 정상 — 이건 비블로킹 부가물의 상태 표면화일 뿐.
type ProbingT = ReturnType<typeof useTranslations>;

function recordingNotSavedReason(
  status: 'empty' | 'error',
  code: string | null,
  t: ProbingT,
): string {
  if (status === 'empty') {
    switch (code) {
      case 'no_audio_track':
      case 'no_audio_captured':
        return t('card.recordingNoAudioTab');
      case 'recorder_unsupported':
        return t('card.recordingUnsupported');
      case 'recorder_start_failed':
        return t('card.recordingStartFailed');
      default:
        return t('card.recordingNoAudio');
    }
  }
  return t('card.recordingUploadFailed');
}

// 슬롯 비치명 에러 코드 → 사람이 읽을 안내(graceful degradation 배너용). 세션
// 에러 토스트 매핑과 동일 카피를 재사용 — both 병렬 캡처에서 한 슬롯만 실패했을
// 때 어느 화자 캡처가 왜 빠졌는지 알린다. 미매핑 코드는 원문 그대로 노출.
function humanSlotError(code: string, t: ProbingT): string {
  switch (code) {
    case 'microphone_denied':
      return t('card.errorMicDenied');
    case 'microphone_failed':
      return t('card.errorMicFailed');
    case 'tab_audio_denied':
      return t('card.errorTabDenied');
    case 'tab_audio_unavailable':
      return t('card.errorTabUnavailable');
    case 'tab_audio_failed':
      return t('card.errorTabFailed');
    case 'probing_connect_timeout':
      return t('card.errorConnectTimeout');
    case 'session_failed':
    case 'session_timeout':
      return t('card.errorSessionStart');
    default:
      return code;
  }
}

// 좌패널 reflection 이 모델에 보낼 누적 transcript 상한.
const REFLECTION_MAX_CHARS = 60_000;
// 우패널 think 가 보낼 transcript 상한.
const THINK_MAX_CHARS = 60_000;
// transcript 60자 미만이면 좌/우 자동 호출 모두 skip.
const MIN_TRANSCRIPT_CHARS = 60;
// transcript 변경 → 자동 호출 debounce.
const DEBOUNCE_MS = 5_000;
// 공유 실시간화: persona 갱신 → broadcast 송출 debounce. reflection/질문 state 가
// 연달아 바뀔 때(스트리밍 머지) 매 tick 송출하지 않고 짧게 합쳐 한 번만 보낸다.
const LIVE_BROADCAST_DEBOUNCE_MS = 700;
// 협업화: think broadcast 로 보낼 최근 사고 흐름 라인 상한(스키마 max 200 이하).
// thinkingEvents 는 무한 누적되므로 tail 만 송출(뷰어는 통째로 교체 — live 흐름
// 이라 오래된 라인 유실 무해). mid-join 뷰어는 다음 tick 에 이 tail 을 받는다.
const LIVE_THINK_BROADCAST_MAX = 120;
// 공유 링크 DB 지속 저장 throttle. broadcast 는 실시간(연결된 뷰어)이지만 DB
// persona_snapshot 도 최신으로 유지해야 mid-join·reload·세션 종료 후 링크가
// 최신 페르소나를 로드한다(스펙 §D 정적 소스). 매 tick 저장은 과하니 최소 간격.
const LIVE_PERSIST_MIN_GAP_MS = 4_000;
// 협업화: 뷰어 inject 수신 rate-limit. 여러 뷰어가 동시/연속 주입해도 호스트는
// 단일 엔진이라 최소 간격으로 순차 처리한다(스팸 폭주 방어, 협업 취지는 유지).
const INJECT_MIN_GAP_MS = 2_500;
// 대기 큐 상한 — 초과 주입은 드롭(과부하 방어). 협업 규모상 충분.
const INJECT_QUEUE_MAX = 12;
// 주입/추가로 생긴 위젯의 ephemeral 하이라이트 지속(ms) — CSS 애니메이션 길이와 정합.
const WIDGET_HIGHLIGHT_MS = 2_000;
// history 보관 cap. 너무 오래 누적되면 메모리 / 표시 부담.
const HISTORY_MAX = 100;

// ─── stateful reflection 병합 헬퍼 (PR: probing-contradiction-aware-persona) ───
// 신호 union(dedup by bullet) — 새 신호를 기존 뒤에 붙이되 같은 bullet 은 무시.
// "누락 0" 의 핵심: 어떤 tick 도 기존 신호를 지우지 않는다.
function mergePersonaSignals(
  existing: ProbingPersonaSignal[],
  incoming: ProbingPersonaSignal[],
): ProbingPersonaSignal[] {
  const seen = new Set(existing.map((s) => s.bullet.trim()));
  const out = [...existing];
  for (const s of incoming) {
    const k = s.bullet.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// conflicts dedup (field+prior+current 동일 쌍 1회만) — 여러 tick 에서 같은 모순이
// 반복 보고돼도 ⚠ 가 중복 쌓이지 않게.
function dedupePersonaConflicts(
  conflicts: ProbingPersonaConflict[],
): ProbingPersonaConflict[] {
  const seen = new Set<string>();
  const out: ProbingPersonaConflict[] = [];
  for (const c of conflicts) {
    const k = `${c.field} ${c.prior} ${c.current}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// PR (probing-question-dedup-cadence) under-supply 방어 — 라이브 중 transcript
// 가 자라는데 오래 think 가 안 돌면(연속 발화로 debounce 가 계속 리셋되는 경우)
// 주기적으로 한 번 유도. 내용 로직·emit cadence 는 그대로라 표출은 여전히
// ProbingEmitGuard 가 캡한다(초반 과잉↔후반 과소 리듬 완화). 중복/cadence/웜업
// 상수·판정 로직은 @/lib/probing/emit-guard 로 분리(테스트 가능 + immutability
// 룰 회피 — 메서드 mutation).
const RETHINK_INTERVAL_MS = 45_000;

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

// 풀뷰 V2 헤더 LIVE chip 경과시간 — mm:ss (1시간 이상이면 h:mm:ss).
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function segmentsText(segments: TranscriptionSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join('\n');
}

// 화자 태그 리터럴 — transcript_window 에 실려 reflection(페르소나) 이 발화
// 귀속을 구분하는 데이터 토큰. **UI 텍스트 아님** — 서버의 한국어 페르소나
// 프롬프트가 이 고정 토큰을 참조하므로 로케일 무관하게 고정한다(STT locale 도
// 'ko' 고정). i18n-allow-korean -- 분석 파이프라인 데이터 토큰(진행자/응답자 귀속)
const SPEAKER_TAG_HOST = '[진행자]';
// i18n-allow-korean -- 분석 파이프라인 데이터 토큰(진행자/응답자 귀속)
const SPEAKER_TAG_GUEST = '[응답자]';

// 페르소나(reflection) 로 넘길 화자 태그 포함 transcript window. both(병렬)
// 모드에서 라인마다 speaker(host/guest)가 있으면 [진행자]/[응답자] 로 라벨링해
// 서버가 응답자 발화만 페르소나 신호로 채굴하고 진행자 발화는 문맥으로만 쓰게
// 한다. 단일 모드(speaker 태그 없음)면 라벨 없이 plain — 옛 동작 100%(후방호환).
function reflectionWindowText(segments: TranscriptionSegment[]): {
  text: string;
  dualSpeaker: boolean;
} {
  const dualSpeaker = segments.some(
    (s) => s.speaker === 'host' || s.speaker === 'guest',
  );
  if (!dualSpeaker) {
    return { text: segmentsText(segments), dualSpeaker: false };
  }
  const text = segments
    .map((s) => {
      const line = s.text.trim();
      if (!line) return '';
      const tag =
        s.speaker === 'host'
          ? SPEAKER_TAG_HOST
          : s.speaker === 'guest'
            ? SPEAKER_TAG_GUEST
            : null;
      return tag ? `${tag} ${line}` : line;
    })
    .filter(Boolean)
    .join('\n');
  return { text, dualSpeaker: true };
}

// 누적 transcript 문자 수 — 웜업(emit 가드) / 최소 길이 게이트 판정용.
function cumulativeCharsOf(segments: TranscriptionSegment[]): number {
  return segments.reduce((sum, s) => sum + s.text.trim().length, 0);
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
  const t = useTranslations('Probing');
  const locale = useLocale();
  const toast = useToast();
  const now = useNowTick();

  const {
    status: sessionStatus,
    segments: rawSegments,
    error: sessionError,
    renewing: sessionRenewing,
    sessionId,
    recording,
    slotActive,
    slotError,
    start: startSession,
    stop: stopSession,
  } = useRealtimeTranscription({ locale: 'ko' });

  // 기본 미선택('') — 사용자가 명시로 고르기 전엔 세션 시작 CTA 가 비활성
  // (아래 startDisabled 게이트). 선택 후에만 실제 값이 start payload 로 발화.
  const [source, setSource] = useState<SourceKind | ''>('');

  // STEP4 질문 입력 draft (결정②) — 아직 추가 안 한 타이핑 중 텍스트. 커밋된
  // 질문 리스트는 context.injected_questions (DB 영속).
  const [questionDraft, setQuestionDraft] = useState('');

  // 분석 출력 언어 — 입력 (STT locale 'ko') 와 독립. 세션마다 새로 선택
  // (영속화 X). 기본 미선택('') — 게이트로 선택 강제. think / reflection 자동
  // 호출은 useCallback 안에서 ref 로 최신 값을 읽는다 (deps 재생성 회피).
  const [outputLang, setOutputLang] = useState<ProbingOutputLang | ''>('');
  const outputLangRef = useRef(outputLang);
  useEffect(() => {
    outputLangRef.current = outputLang;
  }, [outputLang]);

  // 전체보기 — 공유 모달(CanvasBoard FullviewShell)이 소유. probing 이
  // currentKey 일 때만 본문(ProbingFullView)을 모달 slot 으로 portal 한다.
  // 카드(ExpandedBody)는 모달이 열려 있어도 항상 마운트되므로
  // useRealtimeTranscription 세션이 위젯 swap·모달 close 후에도 보존된다
  // (옛 위젯별 모달 + provider hoist 불필요).
  const {
    isCurrent,
    renderInSlot,
    renderInHeaderStart,
    renderInHeaderEnd,
    openFullview,
    close,
  } = useFullview('probing');
  // 풀뷰 V2 셸(캔버스 모달)이면 'modal', 리스트 페이지면 'page'. V2 body 분기.
  const fullviewChrome = useFullviewChrome();

  const isLive = sessionStatus === 'live';

  // 라이브 카드 본문 = "전체보기 유도" 컴팩트 화면 (기본). "Back to setup" 을
  // 누르면 세팅 뷰로 비파괴 토글 — 세션은 계속 진행(세션 중 입력·언어 변경
  // 불가 원칙과 일치). 새 세션 시작 시 runStartSession 에서 prompt 로 리셋.
  const [setupPeek, setSetupPeek] = useState(false);

  // 풀뷰 V2 헤더 LIVE chip 경과시간 기준점 — 라이브 진입 시각(파생 state).
  // sessionStatus 는 hook 외부 전이라 이벤트 훅이 없어 effect 로 1회 캡처한다
  // (fullview open/close 와 무관하게 세션 동안 유지, idle/error 시 클리어).
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  useEffect(() => {
    if (sessionStatus === 'live') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 라이브 진입 시각 1회 캡처(파생 state). sessionStatus 는 외부 hook 전이라 render/event 로 대체 불가.
      setLiveStartedAt((prev) => prev ?? Date.now());
    } else if (sessionStatus === 'idle' || sessionStatus === 'error') {
       
      setLiveStartedAt(null);
    }
  }, [sessionStatus]);

  // 위젯별 동시사용 게이트 (#512) — 세션 start 시 슬롯 획득, 종료 시 반납.
  const gate = useWidgetGate('probing');
  // 세션이 종료(idle) 되거나 실패(error) 하면 슬롯 반납. 정지 버튼 · PDF export
  // 종료 · 시작 실패(live 미도달) · 언마운트 모두 sessionStatus 전환으로 커버.
  const prevSessionStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const prev = prevSessionStatusRef.current;
    prevSessionStatusRef.current = sessionStatus;
    if (prev !== sessionStatus && (sessionStatus === 'idle' || sessionStatus === 'error')) {
      gate.release();
    }
  }, [sessionStatus, gate]);

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
        // OBS-2 퍼널 이벤트 짝 — DB(probing_session_runs) 는 정확 집계용,
        // PostHog widget_action 은 퍼널 시각화용 (이중 계측).
        trackEvent('widget_action', {
          widget: 'probing',
          action: 'session_started',
        });
      }
      return;
    }
    if (sessionStartAtRef.current !== null) {
      const startedAt = sessionStartAtRef.current;
      sessionStartAtRef.current = null;
      const durationMs = Math.max(0, Date.now() - startedAt);
      trackEvent('job_completed', {
        widget: 'probing',
        job_type: 'session',
        duration_ms: durationMs,
      });
      trackEvent('widget_action', {
        widget: 'probing',
        action: 'session_ended',
        metadata: { duration_ms: durationMs },
      });
    }
  }, [sessionStatus]);

  // ─── 우패널 입력 — research_context (DB upsert) ───
  const [context, setContext] = useState<ResearchContext>({
    research_goal: '',
    key_research_question: '',
    injected_questions: [],
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
            key_research_question?: string;
            injected_questions?: string[] | null;
          };
        };
        if (cancelled) return;
        if (j.row) {
          setProbingSessionId(j.row.id ?? null);
          // hypotheses 는 수화하지 않는다 (은퇴 — 유령 재주입 근절).
          setContext({
            research_goal: j.row.research_goal ?? '',
            key_research_question: j.row.key_research_question ?? '',
            injected_questions: j.row.injected_questions ?? [],
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
              key_research_question:
                contextRef.current.key_research_question,
              injected_questions: contextRef.current.injected_questions,
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

  // ─── 프로젝트 설정 (#542) — 페르소나 섹션 구성의 프로젝트별 소스 ───
  // 프로빙 위젯 슬롯의 독립 선택(ProjectSelectionProvider 'probing'). 미선택이면
  // null → 아래 useProbingPersonaConfig 가 로컬 localStorage fallback 으로 동작.
  const { getSelection, setSelection } = useProjectSelection();
  const selectedProjectId = getSelection('probing');
  // 풀뷰 V2 헤더 프로젝트 pill 표시명 — 미선택/미매칭이면 폴백 라벨.
  const { projects } = useInterviewV2Projects();
  const fullviewProjectName =
    projects.find((p) => p.id === selectedProjectId)?.name ??
    t('fv.projectFallback');

  // ─── 페르소나 섹션 구성 (PR: probing-custom-section-ui / #542) ───
  // custom 섹션 정의 + 기본 8 개별 숨김을 선택 프로젝트별 DB(미선택 시
  // localStorage) 에 read/write. 반환 shape 은 옛 useCustomSections +
  // useHiddenDefaults 합집합과 동일 — 소비 로직 무변경, 소스만 프로젝트별로 스위칭.
  // reflection 자동 호출은 useCallback 안에서 ref 로 최신 값을 읽는다.
  const {
    customSections,
    customSectionsHydrated,
    hiddenDefaultKeys,
    hiddenDefaultsHydrated,
    addCustomSection,
    removeCustomSection,
    hideDefault,
    restoreDefault,
  } = useProbingPersonaConfig(selectedProjectId);
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
  // UI-only hide — backend 는 여전히 기본 8 을 required 로 채우고, 여기선 렌더
  // 필터만. hide/restore 는 위 useProbingPersonaConfig 가 제공(프로젝트별 DB /
  // 미선택 시 localStorage). restore 로 즉시 재노출.
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
  // 공유 스냅샷(share-snapshot-persist)은 사용자 클릭 시 imperative 하게 현재
  // reflection/질문을 읽어야 하므로 ref 로 최신값을 들고 있는다.
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  const activePopupRef = useRef(activePopup);
  useEffect(() => {
    activePopupRef.current = activePopup;
  }, [activePopup]);

  // ─── 페르소나 export — 세션 시작 시점 추적 + confirm modal + busy flag ───
  // sessionStartedAt: 라이브 진입 시 한 번 set, 종료 시 docx 메타 (인터뷰 일시 /
  // 인터뷰 길이) 로 사용. 새 세션 시작 시 리셋.
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  // 브라우저 오디오 안내(blocking ack) — source='tab' 경로에서 시작 클릭 시 노출.
  const [browserAudioNoticeOpen, setBrowserAudioNoticeOpen] = useState(false);
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
    async (popup: PopupQuestion, transcriptCutoff?: string) => {
      // probing_questions DB 에 백그라운드 기록 — account-export 가 그대로
      // 동작하도록. 실패는 무시 (위젯 UX 에 영향 X).
      // PR (probing-question-dedup-cadence): transcript_cutoff = 이 질문을 만든
      // think 호출 시점의 transcript window 끝 오프셋. 그동안 insert 에서 누락돼
      // 전 행이 빈 값이었다(중복 방지 근거 + 사후 진단력 부재). 이제 채운다.
      try {
        await fetchWithAuth('/api/probing/questions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: popup.text,
            technique: popup.technique,
            why: popup.rationale,
            // undefined 면 JSON.stringify 가 키를 생략 → 서버는 null 저장(옛 동작).
            transcript_cutoff: transcriptCutoff,
            // 풀뷰 V2 Spotlight — 중요도 영속화(새로고침 후 history 보존).
            importance: popup.importance,
          }),
        });
      } catch {
        // silent
      }
    },
    [],
  );

  // 새 emit 도착 → 중복 가드 + cadence 가드 → popup 큐 처리. 기존 popup 살아
  // 있으면 즉시 history 로 push('replaced') + 새 popup 표시.
  //
  // PR (probing-question-dedup-cadence): auto emit 은 세 게이트를 통과해야 표출·
  // 저장된다 — (A) 이미 낸 질문과 유사하면 drop, (B) 웜업(발화 전) 오프닝 1건
  // 초과 drop, (C) 최소 간격/분당 상한 초과 drop(폭주분 큐 누적 X). 주입 질문
  // (isInjection)은 사용자 명시 행동이라 모든 게이트를 우회한다(스펙 §D 예외).
  const handleEmit = useCallback(
    (
      popup: PopupQuestion,
      opts: {
        cutoff?: string;
        isInjection?: boolean;
        cumulativeChars?: number;
      } = {},
    ) => {
      const { cutoff, isInjection = false, cumulativeChars = 0 } = opts;
      // 중복 + 웜업 + cadence 판정(통과 시 내부 기록). drop 이면 표시/저장 안 함.
      const admitted = emitGuardRef.current.admit(popup.text, {
        isInjection,
        cumulativeChars,
        now: Date.now(),
      });
      if (!admitted) return;

      setActivePopup((current) => {
        if (current) {
          pushHistoryFromPopup(current, 'replaced');
        }
        return popup;
      });
      void persistEmittedQuestion(popup, cutoff);
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
    () => cumulativeCharsOf(rawSegments),
    [rawSegments],
  );

  // ─── PR (probing-question-dedup-cadence): emit 가드 ───
  // 중복 + cadence + 웜업 판정을 캡슐화. 상태 변경은 전부 메서드로만(admit /
  // markThink / reset) — ref 객체의 메서드 mutation 은 react-hooks/immutability
  // 예외라 여러 hook(handleEmit / runThink / 리셋 effect)에서 호출해도 통과한다
  // (emptyCustomRef Map 의 .set/.clear 과 동형).
  const emitGuardRef = useRef(new ProbingEmitGuard());

  // think route 응답 (NDJSON-like 라인 스트림) 을 줄 단위로 dispatch.
  // THINK → 사고 흐름 append, EMIT → popup queue. 자동 think 와 주입 both 사용.
  const consumeThinkStream = useCallback(
    async (
      body: ReadableStream<Uint8Array>,
      opts: {
        cutoff?: string;
        isInjection?: boolean;
        cumulativeChars?: number;
      } = {},
    ) => {
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
          if (popup) handleEmit(popup, opts);
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
      // PR (probing-question-dedup-cadence): 이 think 호출 시점의 transcript
      // window 끝 오프셋 = 전체 transcript 문자 수. 이번 스트림의 모든 emit 이
      // 이 값을 transcript_cutoff 로 공유해 저장한다.
      const cutoff = String(fullText.length);
      // 이번 think 시점 누적 문자 수 — emit 가드 웜업 판정에 넘긴다(이 think 가
      // 생성한 emit 들이 공유). think 호출 시각도 기록(heartbeat 간격 계산용).
      const cumulative = cumulativeCharsOf(segs);
      emitGuardRef.current.markThink(Date.now());

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
            // hypotheses 는 전송하지 않는다 (은퇴 — 프롬프트 유령 주입 근절).
            key_research_question: contextRef.current.key_research_question,
            output_lang: outputLangRef.current,
            injected_questions: injectedQuestions,
            // 이미 낸 질문 이력 → "반복 금지" 프롬프트 축. 주입 호출엔 안 실어
            // (주입은 반드시 emit 돼야 하므로) 이력에 억제되지 않게 한다.
            recent_questions: isInjection
              ? []
              : emitGuardRef.current.recentQuestions(),
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
        await consumeThinkStream(res.body, {
          cutoff,
          isInjection,
          cumulativeChars: cumulative,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : 'think_failed';
        setThinkingError(msg);
        toast.push(t('card.thinkFailed'), {
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
    [toast, consumeThinkStream, t],
  );

  const runThinkRef = useRef(runThink);
  useEffect(() => {
    runThinkRef.current = runThink;
  }, [runThink]);

  // ─── 좌패널 — Reflection Agent (응답자 페르소나) ───
  const runReflection = useCallback(async () => {
    if (reflectionInFlightRef.current) return;
    const segs = rawSegmentsRef.current;
    // both(병렬) 모드면 화자 태그([진행자]/[응답자]) 포함 window — 서버가 응답자
    // 발화만 페르소나 신호로 채굴하고 진행자 발화는 문맥으로만 쓴다(오귀속 방지).
    // 단일 모드면 plain(옛 동작). think 는 화자 미태깅 plain window 그대로(불변).
    const { text: fullText, dualSpeaker } = reflectionWindowText(segs);
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

    // active-section SSOT (PR #470) — 컨트롤 패널 구성기에서 켜진 기본 섹션만
    // 요청에 싣는다. 꺼진 (숨긴) 기본 섹션은 prompt/schema 에서 빠져 데이터
    // 적재 자체가 안 됨 → 전체보기 렌더 (hiddenKeys 필터) 와 정확히 일치.
    // 요청 시점 스냅샷 — 스트리밍 중 토글돼도 이번 호출 key 집합은 고정.
    const hiddenSnapshot = new Set(hiddenDefaultKeysRef.current);
    const activeDefaultKeys = DEFAULT_PERSONA_SECTIONS.map((d) => d.key).filter(
      (k) => !hiddenSnapshot.has(k),
    );
    // 모든 기본 꺼짐 + custom 0 = 채울 섹션 없음. 요청 skip (서버 400 회피).
    if (activeDefaultKeys.length === 0 && requestCustomSections.length === 0) {
      reflectionInFlightRef.current = false;
      setReflectionStatus(reflectionRef.current ? 'ready' : 'idle');
      return;
    }

    // stateful reflection (PR: probing-contradiction-aware-persona) — 직전까지
    // 누적된 현재 패널을 요청 key(활성 기본 key + custom alias)로 인덱싱해 함께
    // 보낸다. custom 은 원본 UUID→alias 로 되돌려 LLM 이 요청 key 와 매칭되게.
    // 내용 있는 패널만(빈 insufficient 는 비교 의미 없음). 첫 tick 은 빈 배열
    // → 서버가 무상태 프롬프트로 폴백(옛 동작 100%).
    const priorRec = (reflectionRef.current ?? {}) as Record<
      string,
      ProbingPersonaSection | undefined
    >;
    const priorPanels: {
      key: string;
      summary: string;
      signals: ProbingPersonaSignal[];
      confidence: ProbingPersonaSection['confidence'];
    }[] = [];
    const pushPrior = (requestKey: string, canonical: string) => {
      const sec = priorRec[canonical];
      if (!sec) return;
      const filled =
        (sec.summary?.trim().length ?? 0) > 0 || (sec.signals?.length ?? 0) > 0;
      if (!filled) return;
      priorPanels.push({
        key: requestKey,
        summary: sec.summary ?? '',
        signals: (sec.signals ?? []).map((s) => ({
          bullet: s.bullet,
          ...(s.quote ? { quote: s.quote } : {}),
        })),
        confidence: sec.confidence,
      });
    };
    for (const k of activeDefaultKeys) pushPrior(k, k);
    for (const c of requestCustomSections)
      pushPrior(c.key, aliasToKey.get(c.key) ?? c.key);

    try {
      const res = await fetchWithAuth('/api/probing/reflection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript_window: trimmed,
          interview_guide: '',
          output_lang: outputLangRef.current,
          // 화자 태그 포함 window 여부 — 서버가 응답자만 페르소나 채굴하는
          // 지시문을 켠다. 단일 모드(false)면 옛 무태깅 동작 100%.
          dual_speaker: dualSpeaker,
          // 활성 기본 섹션 key — 미전달과 달리 명시 목록. 전부 켜져 있으면
          // 기본 9 전체라 옛 동작과 동일.
          default_section_keys: activeDefaultKeys,
          // 빈 배열이면 서버는 활성 기본만.
          custom_sections: requestCustomSections,
          // 직전까지 누적된 패널 — stateful 비교 기준. 빈 배열이면 무상태.
          prior_panels: priorPanels,
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
        // 요청에 실은 활성 기본 key + custom alias 만 파싱 (꺼진 기본은 응답에
        // 없음). active-section SSOT (PR #470).
        const allKeys: string[] = [
          ...activeDefaultKeys,
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
          // stateful 필드 (PR: probing-contradiction-aware-persona) — prior 를
          // 보낸 tick 에서만 채워진다. changeType 미상이면 undefined.
          const changeTypeRaw = sec.changeType;
          const changeType: ProbingChangeType | undefined =
            changeTypeRaw === 'refine' ||
            changeTypeRaw === 'contradict' ||
            changeTypeRaw === 'none'
              ? changeTypeRaw
              : undefined;
          const conflictsRaw = Array.isArray(sec.conflicts)
            ? sec.conflicts
            : [];
          const conflicts: ProbingPersonaConflict[] = conflictsRaw
            .filter(
              (c): c is Record<string, unknown> => !!c && typeof c === 'object',
            )
            .map((c) => ({
              field: typeof c.field === 'string' ? c.field : '',
              prior: typeof c.prior === 'string' ? c.prior : '',
              current: typeof c.current === 'string' ? c.current : '',
              note: typeof c.note === 'string' ? c.note : undefined,
            }))
            .filter(
              (c) =>
                c.prior.trim().length > 0 || c.current.trim().length > 0,
            );
          const hasContent = summary.trim().length > 0 || signals.length > 0;
          // "채워짐" = confidence 가 insufficient 가 아니고 summary/signals 존재
          // (persona-panel 의 isInsufficient 판정과 정합).
          const existing = mergedRec[canonical];
          const existingFilled =
            !!existing &&
            existing.confidence !== 'insufficient' &&
            ((existing.summary?.trim().length ?? 0) > 0 ||
              (existing.signals?.length ?? 0) > 0);
          // 모순 = LLM 이 contradict 로 분류했거나 conflicts 를 실어 보낸 경우.
          const isContradict =
            changeType === 'contradict' || conflicts.length > 0;

          if (!existing) {
            // 첫 등장 — 그대로 채운다 (history 없음).
            mergedRec[canonical] = {
              summary,
              signals,
              confidence,
              ...(conflicts.length > 0 ? { conflicts } : {}),
            };
            anyChange = true;
            if (hasContent) emptyCustomRef.current.delete(canonical);
          } else if (isContradict && existingFilled) {
            // 모순 (A+B): 누락 0 — 기존 신호는 union 으로 화면에 유지, 충돌
            // 지점만 conflicts 로 가시화(⚠), 직전 값을 history 로 밀어 보존.
            const priorSnapshot: ProbingPersonaHistoryEntry = {
              at: Date.now(),
              summary: existing.summary ?? '',
              signals: existing.signals ?? [],
              confidence: existing.confidence,
              changeType: 'contradict',
            };
            mergedRec[canonical] = {
              // current 값 채택 — 단 새 summary 가 비면 기존 유지.
              summary:
                summary.trim().length > 0 ? summary : existing.summary ?? '',
              signals: mergePersonaSignals(existing.signals ?? [], signals),
              // 모순 시 새 confidence 로 재평가. 단 tail-window 손실로 인한
              // insufficient 부당 하향은 막는다(RC-2 취지 보존).
              confidence:
                confidence === 'insufficient'
                  ? existing.confidence
                  : confidence,
              conflicts: dedupePersonaConflicts([
                ...(existing.conflicts ?? []),
                ...conflicts,
              ]),
              history: [...(existing.history ?? []), priorSnapshot],
            };
            anyChange = true;
            if (hasContent) emptyCustomRef.current.delete(canonical);
          } else if (hasContent) {
            // refine (또는 changeType 미상 + 내용 있음) — 조용히 누적. 기존
            // 신호에 새 신호를 union(dedup), summary 갱신. 기존 conflicts/history
            // 는 보존. RC-2: 새 insufficient 는 기존 채움을 덮지 않는다.
            const wouldDowngrade =
              existingFilled && confidence === 'insufficient';
            if (!wouldDowngrade) {
              mergedRec[canonical] = {
                ...existing,
                summary:
                  summary.trim().length > 0
                    ? summary
                    : existing.summary ?? '',
                signals: mergePersonaSignals(existing.signals ?? [], signals),
                confidence:
                  confidence === 'insufficient'
                    ? existing.confidence
                    : confidence,
              };
              anyChange = true;
              emptyCustomRef.current.delete(canonical);
            }
            // wouldDowngrade → 기존 유지 (덮지 않음).
          }
          // changeType='none' & 내용 없음 → 기존 그대로 (아무것도 안 함).
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
        toast.push(t('card.personaFailed'), {
          tone: 'warn',
        });
      }
    } finally {
      reflectionInFlightRef.current = false;
    }
  }, [toast, t]);

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

  // ─── PR (probing-question-dedup-cadence): under-supply 방어 heartbeat ───
  // 연속 발화로 위 debounce 가 계속 리셋되면 think 가 굶어 후반 질문이 급감한다
  // (실측: 후반 32분 2건). 라이브 중 transcript 가 충분하고 마지막 think 이후
  // RETHINK_INTERVAL_MS 이상 지났으면 한 번 유도. inFlight 가드 + emit cadence
  // 가 표출을 캡하므로 폭주 위험은 없다(안전 범위, 내용 로직 무변경).
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      if (cumulativeCharsOf(rawSegmentsRef.current) < MIN_TRANSCRIPT_CHARS)
        return;
      if (Date.now() - emitGuardRef.current.lastThinkAt < RETHINK_INTERVAL_MS)
        return;
      void runThinkRef.current();
    }, RETHINK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isLive]);

  // 새 세션 시작 → in-memory 상태 리셋 (research_context 는 DB 라 유지).
  //
  // RC-1 (회귀 금지): 리셋을 isLive boolean edge (`!prev && isLive`) 가 아니라
  // **새 server session id 등장** 에 게이트한다. boolean edge 는 WebRTC 재연결·
  // 위젯 swap 재마운트·renew 로 live 를 잠깐 벗어났다 복귀하는 모든 경로를
  // "새 세션" 으로 오인해 누적 페르소나 전체를 wipe 했다. session id 는 start()
  // 성공 시에만 새로 발급되고 renew(30분 cap 재연결)는 같은 id 를 재사용하므로,
  // "직전과 다른 새 id 로 시작(idle→start)" 한 진짜 새 세션에만 초기화한다.
  // stop → id null 로의 전이는 리셋 트리거가 아니다 (정지 후에도 페르소나는
  // 화면/PDF export 에 남는다). 다음 start 가 새 id 를 발급하면 그때 초기화.
  // 공유 실시간화: 새 세션이 시작되면 공유 스냅샷(DB + 연결된 뷰어)도 리셋한다.
  // probing_sessions 는 user 당 1 row(공유 링크 재사용)라, 새 인터뷰를 시작해도
  // 과거 persona_snapshot 이 DB 에 남아 뷰어가 과거 기록을 본다(빈 상태는
  // buildPersonaSnapshot 이 null 을 반환해 broadcast 가 skip → 덮이지 않음).
  // 그래서 새 세션 트리거(아래 RC-1 effect)에서 명시적으로 빈 스냅샷을 뿌린다.
  // liveChannelRef 는 이 아래에서 선언되므로 ref-held 클로저로 감싼다.
  const resetSharedSnapshotRef = useRef<() => void>(() => {});

  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    if (sessionId && sessionId !== prev) {
      setReflection(null);
      setReflectionStatus('idle');
      setReflectionLastUpdatedAt(null);
      setReflectionError(null);
      setThinkingEvents([]);
      setThinkingError(null);
      setActivePopup(null);
      setHistory([]);
      emptyCustomRef.current.clear();
      // PR (probing-question-dedup-cadence): 중복/ cadence 가드도 리셋 —
      // 새 인터뷰는 이력·간격 카운터를 깨끗이 시작.
      emitGuardRef.current.reset();
      showBackfillFeedback(null);
      // 진짜 새 세션에만 실행(renew·remount 아님) → 공유 뷰어/ DB 도 초기화.
      resetSharedSnapshotRef.current();
    }
    prevSessionIdRef.current = sessionId;
  }, [sessionId, showBackfillFeedback]);

  // 세션 stop 시 진행 중 think SSE abort. (최종 스냅샷 DB 저장은 buildPersonaSnapshot
  // 선언 뒤의 별도 effect 에서 — 여기선 use-before-declaration 회피.)
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
      toast.push(t('card.copied'), { tone: 'info', ttlMs: 1800 });
    } catch {
      toast.push(t('card.copyFailed'), { tone: 'warn' });
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
    toast.push(t('card.pinnedToHistory'), { tone: 'info', ttlMs: 1500 });
  }, [pushHistoryFromPopup, toast, t]);
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
  const runStartSession = useCallback(async () => {
    // 미선택 게이트 — 언어/입력 소스 중 하나라도 안 골랐으면 시작 안 함
    // (startDisabled 로 버튼도 비활성이지만 payload 안전을 위해 한 번 더 방어).
    // 여기서 source 는 SourceKind 로 좁혀져 빈값이 start 로 새지 않는다.
    if (!source || !outputLang) return;
    // 슬롯 획득 — 정원 초과면 카드에 국소 대기 UI 가 뜨고 admitted 로 바뀔
    // 때까지 여기서 보류된다. 취소/이탈 시 false → 세션 시작 안 함.
    const admitted = await gate.acquire();
    if (!admitted) return;
    // 새 세션은 항상 "전체보기 유도" 화면에서 시작 (직전 세션의 setup-peek 잔상 리셋).
    setSetupPeek(false);
    trackEvent('job_started', { widget: 'probing', job_type: 'session' });
    await startSession({ source });
  }, [gate, startSession, source, outputLang]);
  // 시작 클릭 진입점 — 탭 오디오를 캡처하는 경로(source='tab' 또는 'both')는
  // 캡처 직전 브라우저 오디오 안내를 blocking ack 로 띄운다(both 는 응답자 탭
  // 캡처 + 에코 방지 이어폰 안내 필수 — 615 결합). mic(기기 마이크)은 브라우저
  // 설정 무관이라 바로 진행. "다시 보지 않기"로 억제됐으면 바로 진행.
  const handleStartSession = useCallback(() => {
    if (!source || !outputLang) return;
    if (
      (source === 'tab' || source === 'both') &&
      !isShareGuideSuppressed()
    ) {
      setBrowserAudioNoticeOpen(true);
      return;
    }
    void runStartSession();
  }, [source, outputLang, runStartSession]);
  const handleShareGuideConfirm = useCallback(() => {
    setBrowserAudioNoticeOpen(false);
    void runStartSession();
  }, [runStartSession]);
  const handleStopSession = useCallback(async () => {
    await stopSession();
  }, [stopSession]);

  // ─── 세션 원본 녹음(#554) 다운로드 ───
  // 종료 후 녹음이 업로드되면(recording.status==='ready') signed URL 로 다운로드.
  // 녹음은 비블로킹 부가물 — 세션 종료/결과와 독립.
  const handleDownloadRecording = useCallback(() => {
    const url = recording.downloadUrl;
    if (!url) return;
    // signed URL 이 content-disposition=attachment 를 실어주므로 앵커 클릭으로
    // 새 탭 없이 파일 저장. download 속성은 보조 힌트.
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    trackEvent('widget_action', {
      widget: 'probing',
      action: 'recording_download',
    });
  }, [recording.downloadUrl]);

  // 녹음 상태 전이 toast — ready 안내 + error 경고(세션은 이미 정상 종료).
  const prevRecordingStatusRef = useRef(recording.status);
  useEffect(() => {
    const prev = prevRecordingStatusRef.current;
    prevRecordingStatusRef.current = recording.status;
    if (prev === recording.status) return;
    if (recording.status === 'error') {
      toast.push(t('card.recordingUploadError'), { tone: 'warn', ttlMs: 6000 });
    } else if (recording.status === 'empty') {
      // 캡처된 오디오 0 — 조용히 넘기지 않고 왜 다운로드가 없는지 알린다(#582).
      toast.push(t('card.recordingEmptyNotice'), { tone: 'warn', ttlMs: 6000 });
    } else if (recording.status === 'ready') {
      toast.push(t('card.recordingReady'), {
        tone: 'info',
        ttlMs: 4000,
      });
    }
  }, [recording.status, toast, t]);

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
          eyebrow: t('card.pdfEyebrow'),
          title: goal && goal.length > 0 ? goal : t('card.pdfDefaultTitle'),
          subtitle: endedAt.toLocaleString(locale, {
            dateStyle: 'long',
            timeStyle: 'short',
          }),
        },
      });
      toast.push(t('card.pdfDownloaded'), { tone: 'info', ttlMs: 2200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'export_failed';
      toast.push(t('card.pdfExportFailed', { msg }), { tone: 'warn' });
    } finally {
      setPdfExporting(false);
    }
  }, [pdfExporting, isLive, stopSession, toast, context.research_goal, locale, t]);

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
        ? t('card.errorMicDenied')
        : sessionError === 'microphone_failed'
          ? t('card.errorMicFailed')
          : sessionError === 'tab_audio_denied'
            ? t('card.errorTabDenied')
            : sessionError === 'tab_audio_unavailable'
              ? t('card.errorTabUnavailable')
              : sessionError === 'tab_audio_failed'
                ? t('card.errorTabFailed')
                : sessionError === 'session_timeout'
                  ? t('card.errorSessionTimeout')
                  : sessionError === 'probing_connect_timeout'
                    ? t('card.errorConnectTimeout')
                    : t('card.errorSessionStart');
    toast.push(human, { tone: 'warn' });
  }, [sessionError, toast, t]);

  useEffect(() => {
    if (sessionStatus === 'idle') {
      lastSessionErrorRef.current = null;
    }
  }, [sessionStatus]);

  // idle (!isLive) 상태는 status 텍스트를 노출하지 않는다 (null → hint gate).
  // 다른 status (연결/종료/오류/페르소나/사고 흐름/대기 중) 는 유지.
  const statusLabel: string | null = (() => {
    if (sessionStatus === 'starting') return t('card.statusConnecting');
    if (sessionStatus === 'stopping') return t('card.statusStopping');
    if (sessionStatus === 'error') return t('card.statusError');
    if (!isLive) return null;
    // 30분 cap 재연결 중 — transcript 는 계속 흐르므로 subtle 힌트만.
    if (sessionRenewing) return t('card.statusRenewing');
    if (reflectionStatus === 'streaming') return t('card.statusPersonaUpdating');
    if (thinkingStreaming) return t('card.statusThinking');
    return t('card.statusWaiting');
  })();

  const startDisabled =
    // 언어·입력 소스 미선택('') 이면 세션 시작 불가 (온보딩 게이트).
    !source ||
    !outputLang ||
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

  // 슬롯별 라이브 표시등 대상 — 선택된 캡처 모드의 실제 슬롯(mic=진행자,
  // tab=응답자). both 면 둘, 단일이면 하나, 미선택이면 없음.
  const slotKinds: ('mic' | 'tab')[] =
    source === 'both'
      ? ['mic', 'tab']
      : source === 'tab'
        ? ['tab']
        : source === 'mic'
          ? ['mic']
          : [];

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

  // 주입/추가로 방금 생성된 위젯 key — 좌 grid 에서 ephemeral 하이라이트 대상.
  // 몇 초 뒤 해제해 애니메이션이 한 번만 재생되게 한다.
  const [recentWidgetKeys, setRecentWidgetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const markWidgetAdded = useCallback((key: string) => {
    setRecentWidgetKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setTimeout(() => {
      setRecentWidgetKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, WIDGET_HIGHLIGHT_MS);
  }, []);

  // Analytics — custom 위젯(섹션) 추가 계측. add 원본을 감싸 발화 후 위임.
  const handleAddCustomSection = useCallback(
    (...args: Parameters<typeof addCustomSection>) => {
      trackEvent('widget_action', {
        widget: 'probing',
        action: 'custom_section_add',
      });
      const key = addCustomSection(...args);
      if (key) markWidgetAdded(key);
      return key;
    },
    [addCustomSection, markWidgetAdded],
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
      const DESC = t('card.injectDesc');
      const key = addCustomSection(question, DESC);
      // 위젯 추가 시각 피드백 — 좌 grid 에 새 위젯이 붙었는지 즉시 알 수 있게
      // 토스트로 알린다(호스트 자기 주입 + 뷰어 원격 주입 모두 이 경로).
      const label =
        question.length > 24 ? `${question.slice(0, 24)}…` : question;
      if (key) {
        toast.push(t('card.widgetAdded', { label }), { tone: 'info', ttlMs: 2400 });
        markWidgetAdded(key);
        // 신규 위젯 = 누적 대화 backfill 시도.
        void runBackfillRef.current(key, question, DESC);
      } else {
        // 상한 도달 = 위젯 생성 실패. 질문 자체는 think 로 계속 주입된다.
        toast.push(t('card.widgetFull', { max: CUSTOM_SECTION_MAX }), {
          tone: 'warn',
        });
      }
      void runThinkRef.current([question]);
    },
    [addCustomSection, toast, markWidgetAdded, t],
  );

  // 협업화: 뷰어 inject 수신 → 호스트 자기 주입 핸들러를 그대로 호출하기 위한
  // ref. 채널 구독 effect(probingSessionId 만 dep)가 stable 하게 최신 핸들러를
  // 읽는다.
  const handleInjectQuestionRef = useRef(handleInjectQuestion);
  useEffect(() => {
    handleInjectQuestionRef.current = handleInjectQuestion;
  }, [handleInjectQuestion]);

  // ─── 협업화: 뷰어 inject rate-limit 큐 ───
  // 뷰어가 채널로 보낸 주입을 호스트가 단일 엔진으로 순차 처리한다. 최소 간격
  // (INJECT_MIN_GAP_MS)으로 드레인해 여러 뷰어 동시 주입이 LLM 호출을 폭주시키지
  // 않게 한다. 큐 상한 초과분은 드롭. handleInjectQuestion 은 호스트가 직접
  // 입력한 것과 동일 코드경로(위젯 생성 + priority_sections 가중치 + think).
  const injectQueueRef = useRef<string[]>([]);
  const injectLastAtRef = useRef<number>(0);
  const injectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 드레인/enqueue 는 자기 자신을 재참조(self-scheduling)하므로 useCallback 대신
  // ref-held 클로저로 둔다(순환 참조 lint 회피 + 매 렌더 안정).
  const scheduleDrainRef = useRef<() => void>(() => {});
  const enqueueInjectRef = useRef<(question: string) => void>(() => {});
  useEffect(() => {
    scheduleDrainRef.current = () => {
      if (injectTimerRef.current) return; // 이미 예약됨
      const since = Date.now() - injectLastAtRef.current;
      const wait = Math.max(0, INJECT_MIN_GAP_MS - since);
      injectTimerRef.current = setTimeout(() => {
        injectTimerRef.current = null;
        const next = injectQueueRef.current.shift();
        if (next !== undefined) {
          handleInjectQuestionRef.current(next);
          injectLastAtRef.current = Date.now();
        }
        if (injectQueueRef.current.length > 0) scheduleDrainRef.current();
      }, wait);
    };
    enqueueInjectRef.current = (question: string) => {
      const q = question.trim();
      if (!q) return;
      if (injectQueueRef.current.length >= INJECT_QUEUE_MAX) return; // 폭주 드롭
      injectQueueRef.current.push(q);
      scheduleDrainRef.current();
    };
  }, []);

  // 언마운트 시 드레인 타이머 정리.
  useEffect(
    () => () => {
      if (injectTimerRef.current) clearTimeout(injectTimerRef.current);
    },
    [],
  );

  // ─── 공유 스냅샷 (PR: probing-persona-share-snapshot-persist) ───
  // reflection(8 기본 + custom) + 생성 질문은 in-memory state 라 DB 에 없다.
  // 공유 뷰어(#476)가 그걸 read-only 로 그리려면 먼저 스냅샷을 persist 해야 한다.
  // 공유 버튼 클릭(공유 시점) 직전에 현재 상태를 계약 shape 로 빌드한다.
  const buildPersonaSnapshot =
    useCallback((): ProbingPersonaSnapshot | null => {
      const refl = reflectionRef.current as Record<
        string,
        ProbingPersonaSection | undefined
      > | null;

      // reflection 패널 — 기본 9(DEFAULT_PERSONA_SECTIONS) + custom 순서. 각 칸의
      // 내용은 현재 reflection 결과에서, 아직 안 채워졌으면 insufficient 빈 칸.
      const panels: ProbingPersonaSnapshotPanel[] = [];
      const pushPanel = (key: string, title: string) => {
        const sec = refl?.[key];
        panels.push({
          key,
          title,
          summary: sec?.summary ?? '',
          signals: (sec?.signals ?? []).map((s) => ({
            bullet: s.bullet,
            ...(s.quote ? { quote: s.quote } : {}),
          })),
          confidence: sec?.confidence ?? 'insufficient',
          // v2 (PR: probing-contradiction-aware-persona) — 모순 쌍 + 이력을
          // 뷰어가 read-only 로 렌더하도록 스냅샷에 실는다 (있을 때만).
          ...(sec?.conflicts && sec.conflicts.length > 0
            ? { conflicts: sec.conflicts }
            : {}),
          ...(sec?.history && sec.history.length > 0
            ? { history: sec.history }
            : {}),
        });
      };
      // 활성 섹션만 스냅샷 — 컨트롤 패널에서 끈 기본 섹션은 전체보기 렌더 ·
      // 데이터 적재와 동일하게 공유 뷰어에서도 제외 (불일치 0, PR #470).
      const snapshotHidden = hiddenDefaultKeysRef.current;
      for (const def of DEFAULT_PERSONA_SECTIONS) {
        if (snapshotHidden.has(def.key)) continue;
        pushPanel(def.key, def.title);
      }
      for (const c of customSectionsRef.current) pushPanel(c.key, c.title);

      // 생성 질문 — 현재 popup(있으면) + history, id 로 중복 제거.
      const seen = new Set<string>();
      const questions: ProbingPersonaSnapshotQuestion[] = [];
      const pushQuestion = (q: PopupQuestion, starred: boolean) => {
        if (seen.has(q.id)) return;
        seen.add(q.id);
        questions.push({
          id: q.id,
          text: q.text,
          ...(typeof q.technique === 'string' && q.technique
            ? { technique: q.technique }
            : {}),
          ...(q.rationale ? { rationale: q.rationale } : {}),
          ...(q.importance ? { importance: q.importance } : {}),
          is_starred: starred,
        });
      };
      const cur = activePopupRef.current;
      if (cur) pushQuestion(cur, false);
      for (const h of historyRef.current) pushQuestion(h, h.is_starred);

      // 의미 있는 데이터가 없으면 null → PUT skip. reflection 은 in-memory 라
      // reload 후 null 로 리셋되므로, 빈 스냅샷으로 기존 걸 덮어쓰지 않는다.
      const hasReflection = panels.some(
        (p) => p.summary.trim().length > 0 || p.signals.length > 0,
      );
      if (!hasReflection && questions.length === 0) return null;

      return {
        version: PROBING_PERSONA_SNAPSHOT_VERSION,
        reflection: panels,
        questions,
      };
    }, []);

  // 스냅샷을 자기 probing_sessions row 에 PUT (best-effort). 공유 버튼 훅 +
  // 라이브 지속 저장 + 세션 종료 저장이 공유한다.
  const putPersonaSnapshot = useCallback(
    async (snapshot: ProbingPersonaSnapshot) => {
      try {
        await fetchWithAuth('/api/probing/persona-snapshot', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot),
        });
      } catch {
        // silent — 공유 UX 를 막지 않는다.
      }
    },
    [],
  );

  // DB 지속 저장 throttle 시각(LIVE_PERSIST_MIN_GAP_MS). 세션 종료 저장은 우회.
  const lastPersistAtRef = useRef(0);

  // 공유 버튼 클릭 직전 훅 — 현재 스냅샷을 즉시 저장. 데이터 없으면 null → no-op.
  const snapshotPersonaForShare = useCallback(() => {
    const snapshot = buildPersonaSnapshot();
    if (!snapshot) return;
    lastPersistAtRef.current = Date.now();
    void putPersonaSnapshot(snapshot);
  }, [buildPersonaSnapshot, putPersonaSnapshot]);

  // ─── 공유 실시간화: 호스트 broadcast (probing-persona-share-live-broadcast) ───
  // 요구 변경: 공유는 스냅샷 1회가 아니라 실시간. 라이브 세션 중 페르소나가
  // 갱신되면 공유 뷰어도 같은 갱신을 실시간으로 본다(동시통역 /live 와 동급).
  //
  // 공유 뷰어는 OTP 게이트라 sb-* 세션이 없어 postgres_changes(RLS)는 못 쓴다.
  // 그래서 동시통역이 검증한 broadcast 채널 패턴(translate-console.tsx:18)을
  // 이식: probing-live:<probingSessionId> 로 현재 스냅샷을 송출한다. broadcast 는
  // DB RLS 불필요라 익명 뷰어 수신 OK. DB persist(#493, snapshotPersonaForShare)는
  // 대체가 아니라 초기/mid-join/세션종료후 정적 소스로 그대로 유지 — broadcast=
  // 실시간 delta, DB=초기/영속.
  //
  // 채널 open 은 probingSessionId(공유 resource_id) 가 확보된 뒤. 위젯이 살아
  // 있는 동안 idle 채널 하나만 유지(translate 는 세션이 ephemeral 이라 go-live 에
  // open 하지만, 여기 probingSessionId 는 research context row 라 영속적).
  const liveChannelRef = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    const id = probingSessionId;
    if (!id) return;
    const supa = createBrowserSupabase();
    const ch = supa.channel(probingLiveChannelName(id), {
      // 뷰어에게만 tunnel 하면 되고 호스트는 자기 송출(persona/think)을 되받을
      // 필요가 없다. self:false 는 자기 outbound echo 만 막을 뿐 뷰어가 보낸
      // inject 수신에는 영향 없다.
      config: { broadcast: { self: false } },
    });
    // 협업화: 뷰어 → 호스트 inject 구독. 익명 송신자라 스키마로 방어적 파싱 후
    // rate-limit 큐로 넘긴다. 수신 시 호스트가 자기 주입 핸들러를 그대로 호출 →
    // 위젯 생성·priority_sections·think 가 호스트 직접 주입과 동일하게 실행되고,
    // 결과가 persona/think 재브로드캐스트로 호스트+전 뷰어에 동기화된다.
    ch.on('broadcast', { event: PROBING_LIVE_INJECT_EVENT }, ({ payload }) => {
      const parsed = probingLiveInjectSchema.safeParse(payload);
      if (parsed.success) enqueueInjectRef.current(parsed.data.question);
    });
    ch.subscribe();
    liveChannelRef.current = ch;
    return () => {
      try {
        ch.unsubscribe();
      } catch {
        // ignore
      }
      liveChannelRef.current = null;
    };
  }, [probingSessionId]);

  // persona 갱신 tick → 현재 스냅샷을 broadcast. reflection / 커스텀 섹션 / 숨김 /
  // 질문(history·popup) state 가 바뀔 때마다 짧게 debounce 해 합쳐 송출한다. 채널이
  // 아직 없으면(공유 resource_id 미확보) no-op. buildPersonaSnapshot 이 null(의미
  // 있는 데이터 없음) 이면 송출도 skip 해 빈 스냅샷으로 뷰어를 덮지 않는다.
  //
  // buildPersonaSnapshot 은 refs(reflectionRef/historyRef/…) 를 읽으므로, 이 effect
  // 는 그 ref 들을 갱신하는 effect 들보다 아래(늦게) 선언돼 tick 시점에 refs 가 이미
  // 최신이다. probingSessionId 를 dep 에 두어 채널이 막 열린 직후에도 현재 스냅샷을
  // 한 번 보낸다(mid-join 이전에 이미 채워진 상태 커버).
  useEffect(() => {
    if (!liveChannelRef.current) return;
    const t = setTimeout(() => {
      const snapshot = buildPersonaSnapshot();
      if (!snapshot) return;
      liveChannelRef.current
        ?.send({
          type: 'broadcast',
          event: PROBING_LIVE_PERSONA_EVENT,
          payload: snapshot,
        })
        .catch(() => {
          // best-effort — 다음 tick 이 다시 송출한다. DB 스냅샷이 초기/영속 백업.
        });
      // DB 지속 저장(throttle) — 링크가 mid-join·reload·세션 종료 후에도 최신
      // 페르소나를 로드하도록. broadcast=연결된 뷰어 실시간, DB=그 외 모든 진입.
      const now = Date.now();
      if (now - lastPersistAtRef.current >= LIVE_PERSIST_MIN_GAP_MS) {
        lastPersistAtRef.current = now;
        void putPersonaSnapshot(snapshot);
      }
    }, LIVE_BROADCAST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [
    reflection,
    customSections,
    hiddenDefaultKeys,
    history,
    activePopup,
    probingSessionId,
    buildPersonaSnapshot,
    putPersonaSnapshot,
  ]);

  // ─── 협업화: AI 사고 흐름(think) broadcast ───
  // persona 스냅샷엔 없는 thinkingEvents 를 뷰어 우패널에 실시간 노출한다.
  // 사고 라인이 바뀌거나 streaming 상태가 토글될 때마다 짧게 debounce 해 최근
  // tail 을 전량 송출(뷰어는 통째로 교체 — 멱등, mid-join 안전). 빈 흐름은 skip.
  useEffect(() => {
    if (!liveChannelRef.current) return;
    if (thinkingEvents.length === 0) return;
    const t = setTimeout(() => {
      liveChannelRef.current
        ?.send({
          type: 'broadcast',
          event: PROBING_LIVE_THINK_EVENT,
          payload: {
            events: thinkingEvents.slice(-LIVE_THINK_BROADCAST_MAX),
            streaming: thinkingStreaming,
          },
        })
        .catch(() => {
          // best-effort — 다음 tick 이 다시 송출한다.
        });
    }, LIVE_BROADCAST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [thinkingEvents, thinkingStreaming, probingSessionId]);

  // ─── 세션 종료 시 최종 스냅샷 DB 확정 저장 ───
  // 종료 후 링크(reload/mid-join)가 마지막 페르소나를 정적으로 로드하도록(스펙 §D).
  // 라이브 마지막 tick 이 throttle 창에 걸려 누락됐을 수 있어 우회 저장한다.
  // 새 세션 시작 시엔 리셋 클로저가 빈 스냅샷을 먼저 PUT 하므로 stale 걱정 없음.
  useEffect(() => {
    if (sessionStatus !== 'idle' && sessionStatus !== 'stopping') return;
    const finalSnapshot = buildPersonaSnapshot();
    if (!finalSnapshot) return;
    lastPersistAtRef.current = Date.now();
    void putPersonaSnapshot(finalSnapshot);
  }, [sessionStatus, buildPersonaSnapshot, putPersonaSnapshot]);

  // ─── 공유 스냅샷 리셋 클로저 (새 세션 트리거가 호출) ───
  // 채널이 열려 있을 때만(=공유 대상 row 존재) 동작. ① 연결된 뷰어에 빈 persona +
  // 빈 think 를 즉시 송출(과거 그리드/사고흐름 즉시 클리어), ② DB persona_snapshot
  // 도 빈 스냅샷으로 덮어 mid-join 뷰어가 과거 기록을 로드하지 않게 한다.
  useEffect(() => {
    resetSharedSnapshotRef.current = () => {
      const ch = liveChannelRef.current;
      if (!ch) return; // 공유 채널/row 없으면 리셋할 것도 없음
      const emptySnapshot: ProbingPersonaSnapshot = {
        version: PROBING_PERSONA_SNAPSHOT_VERSION,
        reflection: [],
        questions: [],
      };
      ch.send({
        type: 'broadcast',
        event: PROBING_LIVE_PERSONA_EVENT,
        payload: emptySnapshot,
      }).catch(() => {});
      ch.send({
        type: 'broadcast',
        event: PROBING_LIVE_THINK_EVENT,
        payload: { events: [], streaming: false },
      }).catch(() => {});
      // DB 도 빈 스냅샷으로 덮는다(mid-join 뷰어가 과거 기록을 로드하지 않게).
      lastPersistAtRef.current = Date.now();
      void putPersonaSnapshot(emptySnapshot);
    };
  }, [putPersonaSnapshot]);

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
    // 표시 전용 — 섹션 구성 (추가/삭제/숨김) 은 컨트롤 패널 구성기로 이전
    // (PR #470). hiddenKeys 로 활성 섹션만 렌더.
    customSections,
    hiddenKeys: hiddenDefaultKeys,
    gridRef: personaGridRef,
    // 방금 주입/추가된 위젯 — ephemeral 엔트런스 하이라이트.
    recentKeys: recentWidgetKeys,
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
              // 슬롯별 라이브 표시등 (🎤 진행자 / 📺 응답자) — both 병렬 캡처.
              slotKinds={slotKinds}
              slotActive={slotActive}
              // 페르소나 섹션 구성 (PR #470) — active-section SSOT.
              customSections={customSections}
              hiddenSectionKeys={hiddenDefaultKeys}
              onHideSection={hideDefault}
              onRestoreSection={restoreDefault}
              onRemoveCustomSection={removeCustomSection}
              onAddCustomSection={handleAddCustomSection}
              customSectionsFull={customSectionsFull}
              sectionConfigDisabled={
                !customSectionsHydrated || !hiddenDefaultsHydrated
              }
              // 프로젝트 설정 (#542) — 위젯 슬롯 'probing' 독립 선택.
              projectId={selectedProjectId}
              onProjectChange={(id) => setSelection('probing', id)}
            />
          );

          // idle — 유스케이스 4-스텝 아코디언 (V2 세팅 PR-B). 옛 평면 컨트롤
          // 리스트(ProbingControlPanel)를 대체하되, ControlBoardPanel 프레임은
          // 유지 (.Region = 규격 프레임 + 콘텐츠 자유 — 아코디언 내부 레이아웃은
          // 위젯 자유). live/전체보기 표면은 아래 분기로 그대로(회귀 0).
          if (!isLive && !isCurrent) {
            return (
              <ControlBoardPanel gap="none" fill>
                <ControlBoardPanel.Region fill>
                  <ProbingSetupAccordion
                    projectId={selectedProjectId}
                    onProjectChange={(id) => setSelection('probing', id)}
                    source={source}
                    onSourceChange={setSource}
                    outputLang={outputLang}
                    onOutputLangChange={setOutputLang}
                    questions={context.injected_questions}
                    onQuestionsChange={(next) =>
                      setContext((prev) => ({
                        ...prev,
                        injected_questions: next,
                      }))
                    }
                    questionDraft={questionDraft}
                    onQuestionDraftChange={setQuestionDraft}
                  />
                </ControlBoardPanel.Region>
              </ControlBoardPanel>
            );
          }

          // 라이브 — 카드 본문 = "전체보기 유도" 컴팩트 화면 (세팅 폼 + 질문
          // 기록은 전체보기로 이관). 실제 진행(AI 사고 흐름·제안 질문)은
          // 전체보기 QuestionPane 에만. footer(좌 Session in progress · 우
          // End session)는 유지 — 세션/캡처 로직 회귀 0(본문 표시만 교체).
          if (isLive) {
            // Back to setup 비파괴 토글 — 세팅 뷰(세션-잠금, 세션 계속). CD V2 정합:
            // 옛 평면 컨트롤(ProbingControlPanel) 대신 idle 과 동일한 셋업 아코디언
            // (ProbingSetupAccordion) 을 미러 렌더 → back-to-setup 이 CD `PA_closed`
            // (접힘 요약 아코디언) 로 뜬다. 종료(stop)는 상단 얇은 스트립의
            // "← 전체보기 유도로" 로 prompt 뷰(footer 에 End session)로 복귀해 수행.
            if (setupPeek) {
              return (
                <>
                  <div className="flex shrink-0 items-center border-b border-line-soft px-4 py-2">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setSetupPeek(false)}
                    >
                      {t('live.backToPrompt')}
                    </Button>
                  </div>
                  <ControlBoardPanel active gap="none">
                    <ControlBoardPanel.Region fill>
                      <ProbingSetupAccordion
                        projectId={selectedProjectId}
                        onProjectChange={(id) => setSelection('probing', id)}
                        source={source}
                        onSourceChange={setSource}
                        outputLang={outputLang}
                        onOutputLangChange={setOutputLang}
                        questions={context.injected_questions}
                        onQuestionsChange={(next) =>
                          setContext((prev) => ({
                            ...prev,
                            injected_questions: next,
                          }))
                        }
                        questionDraft={questionDraft}
                        onQuestionDraftChange={setQuestionDraft}
                      />
                    </ControlBoardPanel.Region>
                  </ControlBoardPanel>
                </>
              );
            }
            return (
              <div className="flex min-h-0 flex-1 flex-col">
                {isCurrent ? (
                  // 전체보기 open — 카드는 모달 뒤에 가려짐. 중복 유도 대신 안내.
                  <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm italic text-mute-soft">
                    {t('card.workingInFullview')}
                  </div>
                ) : (
                  <WidgetLiveFullviewPrompt
                    onFullview={openFullview}
                    onBackToSetup={() => setSetupPeek(true)}
                    heading={t('live.fullviewHeading')}
                    sub={t('live.fullviewSubProbing')}
                    backLabel={t('live.backToSetup')}
                  />
                )}
                {/* footer — 좌 진행 상태 · 우 세션 종료. 라이브 정상 시
                    "Session in progress", 30분 cap 재연결(갱신) 중엔 그 힌트를
                    노출. stop 경로는 handleStopSession 로 controlPanel 과
                    동일(세션 종료 로직 불변). */}
                <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
                  <span className="text-xs text-mute">
                    {sessionRenewing
                      ? t('card.statusRenewing')
                      : t('live.sessionInProgress')}
                  </span>
                  <ChromeButton
                    size="lg"
                    onClick={handleStopSession}
                    disabled={stopDisabled}
                  >
                    {t('live.endSession')}
                  </ChromeButton>
                </div>
              </div>
            );
          }

          // 전체보기 open (라이브 아님, idle 프리뷰) — 기존 동작 유지.
          return (
            <>
              <ControlBoardPanel active gap="field">
                {controlPanel}
              </ControlBoardPanel>
              {isCurrent ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm italic text-mute-soft">
                  {t('card.workingInFullview')}
                </div>
              ) : (
                <ProbingCanvasCardBody
                  history={history}
                  nowMs={now}
                  onHistoryCopy={handleHistoryCopy}
                  onHistoryToggleStar={handleHistoryToggleStar}
                  onHistoryDelete={handleHistoryDelete}
                  isLive={isLive}
                  onFullview={openFullview}
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
              // DS-2: 2px-warning offset 은 memphis 토큰 없음(md-warning=3px). 시각 불변 위해 인라인 유지.
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            {t('card.thinkFailedInline', { msg: thinkingError })}
          </div>
        )}
        {/* 슬롯 부분 실패 안내 (graceful degradation) — both 병렬 캡처에서 한
            슬롯만 실패하고 다른 슬롯은 라이브일 때. 세션은 계속 — 어느 화자
            캡처가 빠졌는지만 quiet 하게 알린다. */}
        {isLive && (slotError.mic || slotError.tab) && (
          <div className="mx-3 mb-2 bg-paper px-3 py-2 text-sm text-mute"
            style={{
              border: '1px solid var(--color-line)',
              borderRadius: 'var(--sidebar-nav-radius)',
            }}
          >
            {slotError.mic && (
              <div>
                {t('card.degradedHost')} {humanSlotError(slotError.mic, t)}
              </div>
            )}
            {slotError.tab && (
              <div>
                {t('card.degradedGuest')} {humanSlotError(slotError.tab, t)}
              </div>
            )}
          </div>
        )}
        {/* 세션 원본 녹음(#554) — 종료 후 다운로드 표면. 비라이브에서만, 녹음이
            업로드 중/완료일 때 노출. 부가물이라 세션 시작 CTA 위에 quiet 하게. */}
        {!isLive &&
          (recording.status === 'ready' || recording.status === 'uploading') && (
            <div className="px-4 pb-2">
              {recording.status === 'ready' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={handleDownloadRecording}
                  title={t('card.downloadRecordingTitle')}
                >
                  {t('card.downloadRecording')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  loading
                  loadingLabel={t('card.savingRecording')}
                  disabled
                >
                  {t('card.savingRecording')}
                </Button>
              )}
            </div>
          )}
        {/* 세션 원본 녹음 미저장 표면(#582) — 조용한 생략 대신 "왜 다운로드가
            없는지" 를 quiet 하게 남긴다. empty(캡처 0) / error(업로드 실패) 모두
            비블로킹 — 세션·transcript·결과는 정상. */}
        {!isLive &&
          (recording.status === 'empty' || recording.status === 'error') && (
            <div className="px-4 pb-2">
              <div
                className="bg-paper px-3 py-2 text-sm text-mute"
                style={{
                  border: '1px solid var(--color-line)',
                  borderRadius: 'var(--sidebar-nav-radius)',
                }}
              >
                {t('card.recordingNotSavedPrefix')}
                {recordingNotSavedReason(recording.status, recording.error, t)}
              </div>
            </div>
          )}
        {/* 주 CTA(세션 시작) — 바디 최하단 고정 액션 바 (6 위젯 통일). idle
            (비-라이브) 에서만 노출: 라이브 중 정지 CTA 는 컨트롤 패널에 그대로
            유지. */}
        {!isLive && (
          <WidgetPrimaryCta
            label={t('card.startSession')}
            disabled={startDisabled}
            onClick={handleStartSession}
            // 아코디언 푸터 좌측 상태 라벨 (프로토 D10). ready = 소스+언어 선택 완료.
            statusLabel={
              !source || !outputLang
                ? t('setup.readyPending')
                : t('setup.readyGo')
            }
          />
        )}
      </div>

      {/* 세션 원본 녹음 다운로드 / 공유 초대 / PDF 내보내기 — 레거시·V2 공용
          헤더 액션. V2(모달)는 FullviewShell 헤더 end 슬롯으로 portal, 레거시
          (리스트/page)는 WidgetFullviewPanel headerAction 으로. */}
      {(() => {
        const recordingDownload =
          recording.status === 'ready' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadRecording}
              title={t('card.downloadRecordingTitle')}
            >
              {t('card.downloadRecording')}
            </Button>
          ) : recording.status === 'uploading' ? (
            <Button
              variant="secondary"
              size="sm"
              loading
              loadingLabel={t('card.savingRecording')}
              disabled
            >
              {t('card.savingRecording')}
            </Button>
          ) : null;
        const shareInvite = (
          <ShareInviteButton
            resourceType="probing_persona"
            resourceId={probingSessionId}
            onBeforeOpen={snapshotPersonaForShare}
          />
        );

        // ── 풀뷰 V2 (캔버스 모달) ── FullviewShell 로 렌더. 본문은 fresh
        // ProbingFullviewBody, 헤더는 pill(좌) + 액션(우) 슬롯으로 portal.
        if (fullviewChrome === 'modal') {
          return (
            <>
              {renderInHeaderStart(
                <FullviewProjectPill name={fullviewProjectName} />,
              )}
              {renderInHeaderEnd(
                <>
                  {/* 부가 액션(녹음·공유)은 CD-primary(상태 chip·End-session)
                      좌측 quiet chrome 으로 유지 — 기능 회귀 0. */}
                  {recordingDownload}
                  {shareInvite}
                  {isLive && (
                    <FullviewStatusChip
                      // 경과시간 = now(useNowTick 매초) − 라이브 진입 시각.
                      label={`LIVE ${formatElapsed(
                        liveStartedAt ? now - liveStartedAt : 0,
                      )}`}
                      tone="live"
                    />
                  )}
                  {isLive ? (
                    // End-session(amore-deep) = 세션 종료 + 페르소나 내보내기
                    // 확인 흐름(기존 handlePdfExportClick). 확인 모달이 내보내기를
                    // 명시한다. CD §F3 End-session 크림슨 pill.
                    <FullviewEndSessionButton
                      onClick={handlePdfExportClick}
                      label={t('live.endSession')}
                    />
                  ) : (
                    // 비라이브(세션 종료 후 리뷰) — 내보내기만 노출(종료할 세션
                    // 없음). CD 는 라이브 상태만 그리므로 idle 은 secondary CTA.
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handlePdfExportClick}
                      loading={pdfExporting}
                      loadingLabel={t('card.exporting')}
                      title={t('card.pdfExportTitleIdle')}
                    >
                      {t('card.pdfExportCtaIdle')}
                    </Button>
                  )}
                </>,
              )}
              {renderInSlot(
                <ProbingFullviewBody
                  reflection={reflection}
                  customSections={customSections}
                  hiddenKeys={hiddenDefaultKeys}
                  isLive={isLive}
                  hasTranscript={hasTranscript}
                  gridRef={personaGridRef}
                  thinkingEvents={thinkingEvents}
                  thinkingStreaming={thinkingStreaming}
                  history={history}
                  nowMs={now}
                  onHistoryCopy={handleHistoryCopy}
                  onHistoryToggleStar={handleHistoryToggleStar}
                  onHistoryDelete={handleHistoryDelete}
                  activePopup={activePopup}
                  onPopupCopy={handlePopupCopy}
                  onPopupPin={handlePopupPin}
                  onPopupDismiss={handlePopupManualDismiss}
                  onPopupAutoDismiss={handlePopupAutoDismiss}
                />,
              )}
            </>
          );
        }

        // ── 레거시 (리스트/page) ── 아직 V2 전환 전 표면. WidgetFullviewPanel
        // + ProbingFullView 그대로(회귀 0, 위젯 전환 후 별도 PR 에서 정리).
        return renderInSlot(
          <WidgetFullviewPanel
            title={t('card.fullviewTitle')}
            subtitle={
              context.research_goal?.trim()
                ? context.research_goal
                : isLive
                  ? t('card.fullviewSubtitleLive')
                  : t('card.fullviewSubtitleIdle')
            }
            onClose={close}
            headerAction={
              <>
                {recordingDownload}
                {shareInvite}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handlePdfExportClick}
                  loading={pdfExporting}
                  loadingLabel={t('card.exporting')}
                  title={
                    isLive
                      ? t('card.pdfExportTitleLive')
                      : t('card.pdfExportTitleIdle')
                  }
                >
                  {isLive
                    ? t('card.pdfExportCtaLive')
                    : t('card.pdfExportCtaIdle')}
                </Button>
              </>
            }
          >
            <ProbingFullView
              reflectionProps={reflectionPaneProps}
              questionProps={questionPaneProps}
            />
          </WidgetFullviewPanel>,
        );
      })()}

      <ShareGuidePopup
        open={browserAudioNoticeOpen}
        widget="probing"
        onConfirm={handleShareGuideConfirm}
        onCancel={() => setBrowserAudioNoticeOpen(false)}
        // both(진행자 mic + 응답자 tab 병렬)는 스피커 에코 위험 — 이어폰 안내 결합.
        note={source === 'both' ? t('card.bothEchoNote') : undefined}
      />

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
              {t('card.exportConfirmTitle')}
            </h2>
            <p className="text-sm leading-snug text-mute">
              {t('card.exportConfirmBody')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportCancel}
                disabled={pdfExporting}
              >
                {t('card.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportConfirm}
                loading={pdfExporting}
                loadingLabel={t('card.exporting')}
              >
                {t('card.pdfExportCtaLive')}
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
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051 회귀). 영문 기본 라벨.
    label: 'Probing Assistant',
    labelKey: 'Features.probing.title',
    accent: 'sky',
    cost: 25,
    thumbnail: '/thumbnail/probing.png',
    expandedCols: 3,
    // Canvas 1c 카드 프레임 opt-in — sky 파스텔 헤더밴드 + 통합 툴바(💎25).
    cardFrame: true,
    // 풀뷰 V2 opt-in (pr-fullview-probing) — 캔버스 전체보기를 레거시 모달 대신
    // 공유 FullviewShell(프레임+사이드바+헤더 §F1~F3)로 렌더. body = fresh
    // ProbingFullviewBody(페르소나 그리드+thinking rail+Spotlight, CD state 01·02).
    fullviewV2: true,
  },
  state: 'idle',
  ExpandedBody,
};
