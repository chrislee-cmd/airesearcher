'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useAuth, useRequireAuth } from '@/components/auth-provider';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import {
  useTranscriptJobs,
  type TranscriptJob,
  type TranscriptJobStatus,
} from '@/components/transcript-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { useToast } from '@/components/toast-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import { Button } from '@/components/ui/button';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { IconButton } from '@/components/ui/icon-button';
import { Checkbox } from '@/components/ui/checkbox';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { ControlDropzone } from '@/components/ui/control-dropzone';
import { TranscriptRecordButton } from '@/components/canvas/widgets/transcript-record-button';
import { JobProgress } from '@/components/ui/job-progress';
import { StageFlow, type Stage } from '@/components/ui/stage-flow';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { ModeCardGroup } from '@/components/ui/mode-button';
import { Modal } from '@/components/ui/modal';
import {
  SectionLabel,
  WidgetOutputRow,
} from '@/components/canvas/shell/widget-outputs';
import { WidgetStatusFooter } from '@/components/canvas/shell/widget-status-footer';
import { Field } from '@/components/canvas/shell/field';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetOutputRegion } from '@/components/canvas/shell/widget-output-region';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { LANGUAGES, pickFromBrowser } from '@/lib/transcripts/languages';
import { uploadResumable } from '@/lib/transcripts/resumable-upload';
import { ProjectPicker } from '@/components/project-picker';
import { useProjectSelection } from '@/components/project-selection-provider';

// ── idle 복귀(dismissal) 영속화 ────────────────────────────────────────────
// #805 는 "완료분만 남은 카드를 fullview 로 확인 후 닫으면 idle 로 되돌린다"를
// 세션 내(useRef)로만 처리해, 새로고침/리마운트 시 ref 가 초기화되면 승격
// effect 가 DB 완료분에서 phase='active' 를 재도출 → 결과 뷰로 되돌아갔다.
// 해결: dismissal 을 계정 스코프 localStorage 에 영속화한다. 값은 "확인한
// 완료 job-set 의 시그니처". 마운트 시 저장 시그니처가 현재 완료 job-set 과
// 일치하면 재승격을 막아 idle 을 유지하고, 새 전사가 완료되면 시그니처가
// 바뀌어 저장분과 불일치 → 자동 해제되어 새 완료분은 정상적으로 노출된다.
const DISMISS_KEY_PREFIX = 'quotes:dismissedToIdle:v1';

// 계정(userId) 스코프 — 공용 브라우저에서 다른 사용자의 dismissal 이 섞이지
// 않게. 익명(user 없음)이면 'anon' 으로 폴백.
function dismissStorageKey(userId: string | null): string {
  return `${DISMISS_KEY_PREFIX}:${userId ?? 'anon'}`;
}

// 완료 job id 들의 정렬 결합 = 완료 job-set 시그니처. 새 완료/삭제로 done 집합이
// 바뀌면 시그니처가 바뀐다(순서 무관 — 정렬).
function doneSignature(jobs: TranscriptJob[]): string {
  return jobs
    .filter((j) => j.status === 'done')
    .map((j) => j.id)
    .sort()
    .join(',');
}

function readPersistedDismissal(userId: string | null): string | null {
  try {
    return window.localStorage.getItem(dismissStorageKey(userId));
  } catch {
    return null;
  }
}

function writePersistedDismissal(userId: string | null, signature: string) {
  try {
    window.localStorage.setItem(dismissStorageKey(userId), signature);
  } catch {
    // localStorage 불가(사생활 모드/quota 초과) — 영속화만 실패한다. 세션 내
    // dismissal(ref)은 그대로 동작하므로 조용히 무시.
  }
}

// 스토리지 업로드 완료 후 '시작' 대기 중인 파일 메타. /api/transcripts/start
// 에 그대로 넘긴다.
// 전사 모드 — 'research'(리서치 인터뷰, 현행) | 'meeting'(회의록). 회의록
// 결과물(요약+Todo)은 #485 가 이 값을 소비. 이 카드는 값만 전달·저장.
type TranscriptMode = 'research' | 'meeting';
// 발화자 수 hint — 1 / 2 / 3("3명 이상"). 3/기본은 서버에서 auto diarize 로
// 매핑돼 현행 동작을 보존한다.
type SpeakerCount = 1 | 2 | 3;

type ReadyTranscriptFile = {
  // Row-first: the transcript_jobs row is created at upload start, so every
  // ready file already carries its DB row id. /api/transcripts/start reuses it
  // (uploading → submitting) instead of inserting a second row.
  job_id: string;
  storage_key: string;
  filename: string;
  mime_type?: string;
  size_bytes: number;
  language: string;
  mode: TranscriptMode;
  speaker_count: SpeakerCount;
};

function safeFilename(title: string) {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  return cleaned.replace(/\.md$/i, '');
}

const ACCEPT =
  'audio/*,video/*,text/plain,text/markdown,.txt,.md,.markdown,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// 전사록 공정 단계 — 데스크(6노드)와 미러. 백엔드는 coarse status
// (queued/submitting/transcribing/done)만 노출하고 문서변환/화자분리/오탈자/
// 표현보정 세부 phase 는 서버 내부에서만 일어난다. 따라서 관측 가능한
// 업로드/전사만 실시간 active 로 두고, 후처리 4단계는 reveal dwell 로 완료
// 직전에 순서대로 노출한다(데스크 STAGE_DWELL_MS 패턴 — 가짜 active 조작 없이
// "표시" 인덱스만 걸어 올림). label = Widgets.transcriptStage*, description =
// Process.transcripts.* 재사용. 정적 정의라 모듈 스코프.
// 순서 = 실제 백엔드 파이프라인(poll/route.ts · webhook/elevenlabs/route.ts 실측):
//   전사(ElevenLabs) → mergeSpeakers(화자 분리) → elevenlabsToMarkdown(문서 변환,
//   여기서 markdown 저장 & job done) → [after() 백그라운드] cleanupTranscript(오탈자)
//   → term/number-normalize(표현 보정).
// 즉 문서 변환은 화자 분리 직후 중간 단계이고, 오탈자·표현 보정이 그 뒤에 온다.
const TX_STAGE_DEFS = [
  { id: 'upload', icon: '📤', phase: 'uploading', label: 'transcriptStageUpload' },
  { id: 'transcribe', icon: '🎧', phase: 'transcribing', label: 'transcriptStageTranscribe' },
  { id: 'speaker', icon: '🗣️', phase: 'speaker_diarization', label: 'transcriptStageSpeaker' },
  { id: 'md', icon: '📄', phase: 'md_conversion', label: 'transcriptStageMd' },
  { id: 'typo', icon: '✍️', phase: 'typo_correction', label: 'transcriptStageTypo' },
  { id: 'phrasing', icon: '✨', phase: 'phrasing_polish', label: 'transcriptStagePhrasing' },
] as const;
const TX_STAGE_COUNT = TX_STAGE_DEFS.length;

// ── 멈춤/실패 잡 감지 ──────────────────────────────────────────────────────
// prod 실측(2026-07-10): stuck 3건 = 전부 status='submitting'(5월, error NULL).
// 진짜 멈춤 지점 = 업로드→잡생성/submitting 핸드오프. 현재는 status!=='done' 을
// 전부 "진행 중" 으로 렌더해 오래된 submitting 이 영원히 "진행 중" 으로 남는다
// (완료 리스트에도 없고 실패 표시도 없어 유저 눈엔 "사라짐").
//
// stuck = error(명시적 실패) OR 비종료 상태(submitting/transcribing)로 30분+
// 진전 없음. 판정 기준을 created_at 이 아니라 updated_at 으로 두는 이유: (1)
// updated_at 은 touch 트리거가 매 UPDATE 마다 갱신 = "마지막 진전" 신호이고,
// submitting 에서 멈춘 잡은 insert 이후 UPDATE 가 없어 updated_at≈created_at 이라
// 실제 stuck 3건 감지 결과가 동일하다. (2) 재시도가 성공해 다시 진행되면
// updated_at 이 now() 로 갱신돼 stuck 버킷에서 즉시 벗어난다 — created_at 기준이면
// 오래된 잡이 재시도 직후에도 계속 stuck 으로 오표시된다.
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30분
// 'uploading' row-first 잡은 별도(넉넉한) 임계값. 대용량 파일은 업로드 자체가
// 길어질 수 있어(5GB @ 느린 회선 수십 분~시간) 30분 룰을 쓰면 정상 업로드를
// "멈춤" 으로 오표시한다. 업로드 중엔 어차피 localUploads progress 로 노출되고,
// row 는 항상 리스트에 보이므로("조용히 사라짐" 제거 목표 달성) 여기서는 오직
// 진짜 방치된(탭 종료 등으로 몇 시간째 uploading 인) row 만 재시도 버킷으로
// 승격시킨다.
const UPLOADING_STUCK_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6시간

function isStuckJob(j: TranscriptJob, nowMs: number): boolean {
  if (j.status === 'error') return true;
  if (j.status === 'submitting' || j.status === 'transcribing') {
    const lastProgress = new Date(j.updated_at ?? j.created_at).getTime();
    return nowMs - lastProgress > STUCK_THRESHOLD_MS;
  }
  if (j.status === 'uploading') {
    const lastProgress = new Date(j.updated_at ?? j.created_at).getTime();
    return nowMs - lastProgress > UPLOADING_STUCK_THRESHOLD_MS;
  }
  return false;
}

function formatBytes(n: number | null) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// 전사록 카드 본문 — canvas widget shell 의 ExpandedBody slot 에 마운트.
// chrome / 헤더 (◇ accent + 라벨 + state pill + cost) 는 widget-shell 책임.
// stats 3타일 + 드롭존 + 큐 + 최근 산출물 + 모달은 PR #347 디자인 그대로.
export function QuotesCardBody() {
  const tUp = useTranslations('Features.uploader');
  const tCommon = useTranslations('Common');
  const tWidgets = useTranslations('Widgets');
  const tProcess = useTranslations('Process');
  const tView = useTranslations('Features.transcriptsView');
  const requireAuth = useRequireAuth();
  const { user } = useAuth();
  // 영속 dismissal 키 스코프 (계정별). 로그아웃/계정 전환 시 자동으로 다른
  // 키를 보게 되어 이전 계정의 idle 복귀가 섞이지 않는다.
  const userId = user?.id ?? null;
  const job = useTranscriptJobs();
  const workspace = useWorkspace();
  const toast = useToast();
  // 프로젝트 귀속 (#588) — 위젯 슬롯 'quotes' 의 독립 선택(프로빙/통역과 동일
  // ProjectSelectionProvider). 미선택(null) 허용 — 프로젝트 없이도 전사 생성.
  // 선택값을 create/start 페이로드의 project_id 로 전달한다.
  const { getSelection, setSelection } = useProjectSelection();
  const projectId = getSelection('quotes');
  // 위젯별 동시사용 게이트 (#512) — 전사 잡 시작 시 슬롯 획득, 큐가 모두 끝나
  // isWorking 이 false 로 떨어지면 반납.
  const gate = useWidgetGate('quotes');
  const prevWorkingRef = useRef(false);
  useEffect(() => {
    const prev = prevWorkingRef.current;
    prevWorkingRef.current = job.isWorking;
    if (prev && !job.isWorking) gate.release();
  }, [job.isWorking, gate]);

  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('multi');
  // 전사 모드 — default 'research'(현행 동작 보존). 회의록 결과물은 #485.
  const [mode, setMode] = useState<TranscriptMode>('research');
  // 발화자 수 — default 3("3명 이상") = auto diarize = 현행 동작 보존.
  // 1·2 선택 시에만 서버가 ElevenLabs num_speakers hint 를 실어 보낸다.
  const [speakerCount, setSpeakerCount] = useState<SpeakerCount>(3);
  // 통일 "전체 보기" — 전사 작업 전체를 풀스크린 list + 파일명 검색으로.
  // 공유 모달(CanvasBoard FullviewShell)이 소유하고 quotes 가 currentKey 일
  // 때만 본문을 모달 slot 으로 portal. useTranscriptJobs provider 기반이라
  // close 후 보존되고, 파일명 검색어(fullviewQuery)는 항상-마운트된 카드
  // 본문에 남아 모달 close 후에도 유지된다. 카드 바닥의 "더보기"(overflow)
  // 모달과는 의미가 다른 별도 진입 — 더보기는 그대로 유지.
  const { isCurrent, renderInSlot, openFullview, close: closeFullview } = useFullview('quotes');
  const [fullviewQuery, setFullviewQuery] = useState('');

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'quotes' });
  }, []);

  // 통일 "전체 보기" 진입 계측.
  const handleQuotesFullview = () => {
    trackEvent('widget_action', { widget: 'quotes', action: 'fullview_open' });
    trackEvent('widget_viewed', { widget: 'quotes', fullview: true });
    openFullview();
  };
  // Files held between FileDropZone receiving them and the user confirming
  // the language in the modal. Picking the wrong language is the single
  // biggest accuracy regression for transcripts (Korean audio sent to an
  // English model comes back almost unusable), so we gate every upload
  // on an explicit confirm rather than silently using whatever the
  // dropdown last had.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  // 자동 전사 시작에 실패한 파일들의 재시도 버킷. 정상 흐름에선 업로드 완료
  // 즉시 startTranscriptionFor 가 돌아 비어 있고, /api/transcripts/start 가
  // 실패한 파일만 여기 남아 서브헤더 '전사 시작(재시도)' CTA 로 다시 시작한다.
  const [readyFiles, setReadyFiles] = useState<ReadyTranscriptFile[]>([]);

  // 위젯 phase — 'idle' (아직 실행 신호 없음) → 'active' (실행 중/완료).
  // 컨트롤 패널은 phase 무관 항상 노출되고, phase 는 그 아래 산출물 영역의
  // 렌더 여부만 가른다 (active 일 때만 업로드/큐/상태 노출). CTA(업로드 시작)
  // 시 active 로 승격한다. 예외로, 전사 완료분만 남은 상태에서 사용자가
  // "전체 보기"(fullview)로 산출물을 확인하고 닫으면 카드를 idle 로 되돌려
  // 새 작업 준비 상태로 만든다 (진행 중이면 유지 — 아래 handleCloseFullview).
  const [phase, setPhase] = useState<'idle' | 'active'>('idle');
  // fullview 를 확인하고 닫아 idle 로 되돌린 신호. 완료분만 있는 상태에서
  // 아래 승격 effect 가 다시 active 로 올리지 않도록 막는다. 진행/업로드/대기
  // 신호가 새로 생기면 해제된다. 뷰 상태 전용 ref — DB 산출물은 보존된다.
  const dismissedToIdleRef = useRef(false);

  // ── 완료 표면 세션 스코프 (#187 데스크 latestJob 동형) ─────────────────────
  // 과거 완료 잡을 fresh 로그인마다 완료 StageFlow 로 영원히 재상영하던 회귀
  // (prod 실측 2026-07-10 — DB 는 전부 done, 표시 로직 문제)를 제거한다. "이
  // 브라우저 세션에서 non-done → done 으로 전이한" 잡 id 만 여기 쌓이고, 아래
  // 승격 effect 의 완료 표면 승격은 이 집합에 걸린다. 마운트 시 이미 done 인
  // 과거 잡은 전이가 아니라 첫 관측(seed)이므로 제외 → 과거 done 만 존재하면
  // idle 컨트롤 보드로 남는다. 과거 결과물 접근은 그대로(doneJobs 리스트/전체
  // 보기/다운로드 — 휴식 얼굴만 바뀐다). 다른 디바이스에서 완료돼 realtime 으로
  // 넘어온 잡도 이 세션에선 전이를 못 봤으므로 idle 유지(보수적 — 결과는 접근
  // 가능). 업로드→완료 실시간 전이(세션 내)는 전이를 관측하므로 완료 연출 유지.
  const sessionStatusRef = useRef<Map<string, TranscriptJobStatus>>(new Map());
  const [sessionCompletedIds, setSessionCompletedIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    let added: string[] | null = null;
    for (const j of job.jobs) {
      const prev = sessionStatusRef.current.get(j.id);
      sessionStatusRef.current.set(j.id, j.status);
      // 전이만 카운트 — 첫 관측(prev 없음: 마운트 시 로드된 과거 잡)과 동일
      // status 재관측은 무시. non-done → done 전이만 "세션 내 완료" 로 기록.
      if (!prev || prev === j.status) continue;
      if (j.status === 'done') (added ??= []).push(j.id);
    }
    if (added) {
      const ids = added;
       
      setSessionCompletedIds((prevSet) => {
        const next = new Set(prevSet);
        for (const id of ids) next.add(id);
        return next;
      });
    }
  }, [job.jobs]);

  // 실행 신호(진행/완료 잡, 로컬 업로드, 시작 대기 파일)가 하나라도 있으면
  // active 로 승격. 새로고침/다른 디바이스에서 이미 잡이 있는 경우(realtime
  // 로 늦게 로드)도 이 effect 가 idle→active 를 처리한다. 단, 완료분만 남고
  // 사용자가 fullview 를 확인 후 닫아 idle 로 되돌린 경우(dismissedToIdleRef)
  // 는 재승격하지 않는다 — 진행/업로드/대기 같은 새 신호가 생기면 dismissal
  // 을 해제하고 다시 active 로 올린다.
  useEffect(() => {
    const inflightJobs = job.jobs.some((j) => j.status !== 'done');
    const uploadsActive = Object.keys(job.localUploads).length > 0;
    const readyPending = readyFiles.length > 0;
    if (inflightJobs || uploadsActive || readyPending) {
      dismissedToIdleRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- promote on external job state
      setPhase('active');
      return;
    }
    // 완료분만 남은 상태: 세션 스코프 게이트(#187) — 이 세션에서 완료로 전이한
    // 잡이 있을 때만 완료 표면으로 승격한다. fresh 로그인(과거 done 만 존재,
    // 세션 완료 0)은 승격하지 않고 idle 컨트롤 보드로 남겨 "과거 완료 잡 영원히
    // 재상영"(StageFlow 잔상)을 제거한다.
    if (job.jobs.length > 0) {
      const hasSessionCompletion = job.jobs.some(
        (j) => j.status === 'done' && sessionCompletedIds.has(j.id),
      );
      if (!hasSessionCompletion) return;
      // 세션 내 완료분 존재 — fullview 확인 후 idle 로 되돌린 게 아니면 승격.
      // 영속 dismissal 복원 — 새로고침/리마운트로 ref 가 초기화됐어도, 저장된
      // 시그니처가 현재 완료 job-set 과 일치하면 사용자가 이미 확인·idle 로
      // 되돌린 job-set 이므로 재승격하지 않는다. 시그니처가 다르면(새 완료분)
      // 저장분과 불일치 → dismissal 이 해제되어 정상적으로 결과 뷰를 노출.
      if (
        !dismissedToIdleRef.current &&
        readPersistedDismissal(userId) === doneSignature(job.jobs)
      ) {
        dismissedToIdleRef.current = true;
      }
      if (!dismissedToIdleRef.current) {
        setPhase('active');
      }
    }
  }, [job.jobs, job.localUploads, readyFiles.length, userId, sessionCompletedIds]);

  // `startUploads` is wrapped in useCallback with empty deps, so the closure
  // around `uploadToStorage` is captured once. We mirror live state into a
  // ref so the captured uploadToStorage still reads the current language.
  const languageRef = useRef<string>(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  // 언어와 같은 이유로 mode/speakerCount 도 ref 미러 — 업로드 완료 후
  // ReadyTranscriptFile 을 만드는 시점의 최신 선택을 안정적으로 읽는다.
  const modeRef = useRef<TranscriptMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const speakerCountRef = useRef<SpeakerCount>(speakerCount);
  useEffect(() => {
    speakerCountRef.current = speakerCount;
  }, [speakerCount]);
  // 선택 프로젝트도 같은 이유로 ref 미러 — 업로드/전사 시작 시점의 최신 선택을
  // create/start 페이로드에 안정적으로 실어 보낸다(미선택=null).
  const projectIdRef = useRef<string | null>(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Default the selector to the browser locale on mount. SSR-safe — initial
  // value is "multi" so the server and first client render agree.
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to external/prop/ref change
      setLanguage(pickFromBrowser(navigator.language));
    }
  }, []);

  // Poll ElevenLabs jobs. Workspace webhook delivery proved unreliable
  // (no delivery attempts ever recorded), so the client drives completion
  // by hitting our /poll endpoint, which proxies the ElevenLabs GET. When
  // it flips DB to `done`, realtime in TranscriptJobProvider picks it up.
  useEffect(() => {
    const pending = job.jobs.filter(
      (j) => j.status === 'transcribing' && j.provider === 'elevenlabs',
    );
    if (pending.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      // When the server flips a job to 'done', the realtime channel should
      // refresh us — but that hop has been unreliable enough to keep the UI
      // stuck at "전사 중 95%" until a manual reload. Read the poll response
      // directly and call refreshJobs on terminal states so the UI advances
      // even if the realtime broadcast never arrives.
      let sawTerminal = false;
      await Promise.all(
        pending.map((j) =>
          fetch(`/api/transcripts/jobs/${j.id}/poll`, { method: 'POST' })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { status?: string } | null) => {
              if (body?.status === 'done' || body?.status === 'error') {
                sawTerminal = true;
              }
            })
            .catch(() => {}),
        ),
      );
      if (sawTerminal && !cancelled) await job.refreshJobs();
    };
    void tick(); // first hit immediately so completed jobs flip fast on mount
    const id = setInterval(() => {
      if (!cancelled) void tick();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [job, job.jobs]);

  const startUploads = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      requireAuth(() => {
        // Don't upload yet — open the language-confirm modal and let the
        // user verify. uploadToStorage fires only after confirm.
        setPendingFiles(Array.from(files));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function confirmPendingUpload() {
    const files = pendingFiles;
    setPendingFiles(null);
    if (files && files.length > 0) {
      void uploadToStorage(files);
    }
  }

  function cancelPendingUpload() {
    setPendingFiles(null);
  }

  // 스토리지 업로드 → 완료 즉시 자동 전사 시작 (수동 '시작' 클릭 제거).
  // 업로드된 파일은 startTranscriptionFor 로 바로 큐에 들어가 진행중
  // 프로그레스가 끊기지 않는다. 시작 실패분만 readyFiles 로 남는다.
  async function uploadToStorage(files: File[]) {
    if (busyUpload) return;
    // CTA 확정 — idle 컨트롤 보드에서 active(slim bar + 진행률)로 전이.
    // 업로드 progress 가 곧바로 본문에 뜨도록 업로드 시작 시점에 승격.
    setPhase('active');
    setBusyUpload(true);
    setUploadError(null);
    const uploaded: ReadyTranscriptFile[] = [];
    try {
      for (const file of files) {
        const tempId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        // Row-first: the DB row for this file, created BEFORE the upload runs.
        // Held out here so the catch can flip it to 'error' if the upload
        // fails (row stays visible instead of orphaning the file).
        let jobId: string | null = null;
        try {
          job.setUploadProgress(tempId, 0);

          // 1) 서버에서 objectKey 발급 (userId 프리픽스 + safe filename).
          //    resumable 업로드는 서명 URL 이 아니라 사용자 세션 토큰으로 올려
          //    RLS(audio_user_insert) 를 통과하므로 upload_url/token 은 안 쓴다.
          const urlRes = await fetch('/api/transcripts/upload-url', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename: file.name }),
          });
          if (!urlRes.ok) {
            const err = await urlRes.json().catch(() => ({}));
            throw new Error(err.error ?? `upload-url ${urlRes.status}`);
          }
          const { storage_key } = (await urlRes.json()) as {
            storage_key: string;
          };

          // 2) row-first — 업로드 시작 시점에 per-file transcript_jobs row 선생성
          //    (status 'uploading'). 이 시점에 실패해도 아직 파일은 스토리지에
          //    안 올라갔으므로 고아가 없다. 성공하면 row 가 즉시 리스트에 떠서
          //    이후 업로드/전사가 어디서 멈추든 "조용히 사라짐" 이 불가능해진다.
          const createRes = await fetch('/api/transcripts/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              storage_key,
              filename: file.name,
              mime_type: file.type || undefined,
              size_bytes: file.size,
              language: languageRef.current,
              project_id: projectIdRef.current,
              mode: modeRef.current,
              speaker_count: speakerCountRef.current,
            }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            throw new Error(err.error ?? `create ${createRes.status}`);
          }
          jobId = ((await createRes.json()) as { id: string }).id;
          // 선생성 row 를 즉시 표면화 (realtime 이 늦거나 누락돼도 리스트에 뜨게).
          await job.refreshJobs();

          // 3) resumable(TUS) 업로드 — 6MB 청크 + 자동 재시도/이어받기로
          //    대용량 영상도 네트워크 끊김(ERR_CONNECTION_RESET)에 견딘다.
          //    (단일 PUT 은 큰 파일 전송 중 한 번만 끊겨도 전체 리셋됐다.)
          await uploadResumable({
            file,
            objectKey: storage_key,
            contentType: file.type || undefined,
            onProgress: (pct) => job.setUploadProgress(tempId, pct),
          });
          job.setUploadProgress(tempId, 100);

          // 4) 업로드 성공 — 언어는 확인 시점 값으로 고정해 적재. 루프 종료 후
          //    한꺼번에 자동 전사 시작(선생성 row 를 job_id 로 재사용).
          uploaded.push({
            job_id: jobId,
            storage_key,
            filename: file.name,
            mime_type: file.type || undefined,
            size_bytes: file.size,
            language: languageRef.current,
            mode: modeRef.current,
            speaker_count: speakerCountRef.current,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'upload_failed';
          setUploadError(msg);
          // row-first: 업로드/핸드오프가 실패했고 이미 row 를 만들었다면 error 로
          // 표시해 리스트에 남긴다(고아 대신 재시도/삭제 가능한 실패 행).
          if (jobId) {
            await fetch(`/api/transcripts/jobs/${jobId}/fail`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ message: msg }),
            }).catch(() => {});
          }
        } finally {
          job.clearUploadProgress(tempId);
        }
      }
      // 업로드 완료 → 자동 전사 시작. 사용자 '시작' 클릭 없이 곧바로 큐로
      // 넘어가고, 시작에 실패한 파일만 startTranscriptionFor 가 readyFiles 로
      // 남겨 재시도할 수 있게 한다.
      if (uploaded.length > 0) {
        await startTranscriptionFor(uploaded);
      }
    } finally {
      setBusyUpload(false);
    }
  }

  // 전사 시작 — 주어진 파일 각각에 /api/transcripts/start 호출 (provider 는
  // language-driven: English → Deepgram nova-3, else → ElevenLabs). 성공분은
  // readyFiles 에서 제거, 실패분은 readyFiles 에 남겨 '재시도' 가능.
  // busyUpload 는 호출자(uploadToStorage / startTranscription)가 관리한다.
  async function startTranscriptionFor(files: ReadyTranscriptFile[]) {
    if (files.length === 0) return;
    // 슬롯 획득 — 정원 초과면 카드 국소 대기 UI 후 admitted 시 자동 진행.
    const admitted = await gate.acquire();
    if (!admitted) {
      // 게이트가 슬롯을 안 줬을 때(정원 대기 중 취소 등). row-first 라 이 파일들의
      // transcript_jobs row 는 이미 존재('uploading')하므로 리스트에서 사라지지
      // 않는다(게이트가 row 생성을 막지 못함 — 스펙 결정 2). 여기서는 전사 시작만
      // 지연하고, 재시도 버킷(readyFiles)에도 남겨 하단 "전사 시작" CTA 로 즉시
      // 복구할 수 있게 한다(false "처리됨" 방지 — 스펙 결정 3).
      setReadyFiles((prev) => {
        const keys = new Set(prev.map((r) => r.storage_key));
        return [...prev, ...files.filter((r) => !keys.has(r.storage_key))];
      });
      setUploadError(tView('uploadSlotWaiting'));
      return;
    }
    setUploadError(null);
    const queue = [...files];
    try {
      while (queue.length > 0) {
        const rf = queue[0];
        const startRes = await fetch('/api/transcripts/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // row-first: 선생성 row 를 재사용(uploading → submitting). 두 번째
            // row insert 없음.
            job_id: rf.job_id,
            storage_key: rf.storage_key,
            filename: rf.filename,
            mime_type: rf.mime_type,
            size_bytes: rf.size_bytes,
            language: rf.language,
            project_id: projectIdRef.current,
            mode: rf.mode,
            // 사용자 선택값(1/2/3)을 그대로 저장. 서버가 1·2 만 ElevenLabs
            // num_speakers hint 로 매핑하고 3("3명 이상")은 auto 로 둔다.
            speaker_count: rf.speaker_count,
          }),
        });
        if (!startRes.ok) {
          const err = await startRes.json().catch(() => ({}));
          throw new Error(err.error ?? `start ${startRes.status}`);
        }
        track('transcripts_upload_start', {
          type: rf.mime_type,
          size: rf.size_bytes,
          language: rf.language,
        });
        trackEvent('job_started', { widget: 'quotes', job_type: 'transcribe' });
        queue.shift();
        // 시작 성공 — readyFiles 에 남아 있었다면 제거.
        setReadyFiles((prev) =>
          prev.filter((r) => r.storage_key !== rf.storage_key),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'start_failed';
      setUploadError(msg);
      // 시작 못 한 나머지는 readyFiles 에 남겨 사용자가 재시도.
      setReadyFiles((prev) => {
        const keys = new Set(prev.map((r) => r.storage_key));
        return [...prev, ...queue.filter((r) => !keys.has(r.storage_key))];
      });
    } finally {
      await job.refreshJobs();
    }
  }

  // 서브헤더 '전사 시작' CTA — 자동 시작이 실패해 readyFiles 에 남은 파일만
  // 재시도한다. 정상 흐름(업로드 → 자동 시작 성공)에선 readyFiles 가 비어
  // 이 버튼이 렌더되지 않는다.
  async function startTranscription() {
    if (readyFiles.length === 0 || busyUpload) return;
    setBusyUpload(true);
    try {
      await startTranscriptionFor([...readyFiles]);
    } finally {
      setBusyUpload(false);
    }
  }

  function handleArtifactDrop(e: React.DragEvent): boolean {
    let ids: string[] = [];
    const manyRaw = e.dataTransfer.getData(
      'application/x-workspace-artifacts',
    );
    if (manyRaw) {
      try {
        ids = JSON.parse(manyRaw) as string[];
      } catch {
        ids = [];
      }
    }
    if (ids.length === 0) {
      const id = e.dataTransfer.getData('application/x-workspace-artifact');
      if (id) ids = [id];
    }
    if (ids.length === 0) return false;
    const lookup = new Map(workspace.artifacts.map((a) => [a.id, a] as const));
    // Content lives in the DB now — fetch each artifact lazily and start
    // uploads once all are resolved.
    void (async () => {
      const files: File[] = [];
      for (const id of ids) {
        const a = lookup.get(id);
        if (!a) continue;
        const c = await workspace.fetchContent(a);
        if (!c) continue;
        files.push(
          new File([c.content], `${safeFilename(a.title)}.md`, {
            type: 'text/markdown',
          }),
        );
      }
      if (files.length > 0) startUploads(files);
    })();
    workspace.setDragging(null);
    return true;
  }

  async function deleteJob(id: string) {
    if (!confirm(tView('deleteJobConfirm'))) return;
    const res = await fetch(`/api/transcripts/jobs/${id}`, { method: 'DELETE' });
    if (res.ok) job.removeJob(id);
    await job.refreshJobs();
  }

  // 멈춤/실패 잡 재시도 — 기존 storage_key 로 서버가 같은 row 를 재전사(핸드오프
  // 재시도). 새 row/재업로드/중복 과금 없음. 성공 시 status 가 submitting→
  // transcribing 으로 바뀌고 updated_at 이 now() 로 갱신돼 stuck 버킷에서 벗어난다.
  async function retryJob(id: string) {
    setUploadError(null);
    try {
      const res = await fetch(`/api/transcripts/jobs/${id}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `retry ${res.status}`);
      }
      toast.push(tView('retryStarted'), { tone: 'info' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'retry_failed';
      toast.push(tView('retryFailed', { msg }), { tone: 'warn' });
    } finally {
      await job.refreshJobs();
    }
  }

  // 진행 중 전사 강제종료 (데스크 cooperative cancel 미러) — inflight 큐의 각
  // 잡에 cancel 호출. 낙관적으로 status='cancelled' 를 반영해 프로그레스가 즉시
  // 멈추고(큐/StageFlow 에서 빠짐), 서버는 terminal cancelled + 환불(차감분 있으면).
  // 프로바이더 잡은 서버측 hard-kill 불가라 결과만 폐기(cooperative).
  const [stopping, setStopping] = useState(false);
  async function cancelInflight() {
    if (stopping) return;
    // 진행 중(제출/전사/대기) 잡만 취소 대상 — done/error/cancelled 는 제외.
    // queueJobs(파생값)를 참조하지 않고 job.jobs 에서 직접 필터해 함수 정의
    // 시점의 TDZ(하단 선언 파생값 참조)로 컴파일러가 바일아웃하는 것을 피한다.
    const targets = job.jobs
      .filter(
        (j) =>
          j.status === 'queued' ||
          j.status === 'submitting' ||
          j.status === 'transcribing',
      )
      .map((j) => j.id);
    if (targets.length === 0) return;
    setStopping(true);
    try {
      await Promise.allSettled(
        targets.map((id) =>
          fetch(`/api/transcripts/jobs/${id}/cancel`, { method: 'POST' }).then(
            (r) => {
              if (r.ok) {
                // 낙관 반영 — realtime/refresh 가 곧 확정.
                const j = job.jobs.find((x) => x.id === id);
                if (j) job.upsertJob({ ...j, status: 'cancelled' });
              }
            },
          ),
        ),
      );
      trackEvent('widget_action', { widget: 'quotes', action: 'cancel' });
    } finally {
      setStopping(false);
      await job.refreshJobs();
    }
  }

  // ── fullview 일괄 선택/액션 ────────────────────────────────────────────
  // 선택된 잡 id 집합. fullview("전체 보기") 안에서만 노출/사용된다. 카드
  // 본문 큐/산출물 목록엔 체크박스가 없어 개별 삭제/다운로드 회귀 없음.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 일괄 삭제 confirm 모달 (결정 3 — 삭제만 confirm, 다운로드는 바로). busy 는
  // 병렬 DELETE inflight 동안 버튼 중복 클릭 방지.
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // fullview 가 닫힐 때(× / Esc / backdrop / 사이드바 전환 모두)의 side effect.
  // 공유 모달은 canvas-board 의 closeFullview(= shell context close)로 닫혀
  // 위젯 패널의 onClose 를 우회할 수 있으므로, 이 위젯이 fullview 로 보이는
  // 중인지(isCurrent) 의 true→false 전이를 직접 감지해 처리한다.
  //   1) 선택 리셋 — 다음에 열었을 때 지난 선택이 남지 않도록.
  //   2) 전사 완료분만 남았으면 카드를 idle 로 되돌려 새 작업 준비 상태로
  //      (spec B). 진행 중(업로드/시작 대기/전사 inflight)이면 유지. 뷰 상태만
  //      리셋 — 전사 job/파일은 DB-backed 이라 fullview 재진입 시 그대로 보인다.
  const prevIsCurrentRef = useRef(isCurrent);
  useEffect(() => {
    const wasCurrent = prevIsCurrentRef.current;
    prevIsCurrentRef.current = isCurrent;
    // 열림→닫힘 전이에서만 동작 (열림 자체/미변경은 무시).
    if (!wasCurrent || isCurrent) return;
    setSelected(new Set());
    const inflight =
      busyUpload ||
      readyFiles.length > 0 ||
      Object.keys(job.localUploads).length > 0 ||
      job.jobs.some((j) => j.status !== 'done');
    const hasDone = job.jobs.some((j) => j.status === 'done');
    if (hasDone && !inflight) {
      dismissedToIdleRef.current = true;
      // 새로고침 생존 — 지금 확인한 완료 job-set 시그니처를 영속화한다.
      // 마운트 시 승격 effect 가 이 시그니처와 일치하면 재승격을 막아 idle 을
      // 유지한다. 계정당 키 1개라 다음 dismissal 때 덮어써져 누적되지 않는다.
      writePersistedDismissal(userId, doneSignature(job.jobs));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset view to idle on fullview close
      setPhase('idle');
    }
  }, [isCurrent, busyUpload, readyFiles.length, job.jobs, job.localUploads, userId]);

  // 일괄 삭제 — 결정 1: 신규 endpoint 없이 기존 개별 DELETE 를 병렬 호출.
  // Promise.allSettled 로 일부 실패해도 나머지는 반영, 결과 count 를 toast.
  async function bulkDelete(ids: string[]) {
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/transcripts/jobs/${id}`, { method: 'DELETE' }).then((r) => {
            if (!r.ok) throw new Error(`delete ${id} ${r.status}`);
            return id;
          }),
        ),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      // 성공분은 즉시 provider 에서 제거 — refresh 전에도 목록이 줄어든다.
      for (const r of results) {
        if (r.status === 'fulfilled') job.removeJob(r.value);
      }
      if (failed === 0) {
        toast.push(tView('bulkDeleteDone', { count: succeeded }), { tone: 'info' });
      } else {
        toast.push(tView('bulkDeletePartial', { succeeded, failed }), { tone: 'warn' });
      }
    } finally {
      clearSelection();
      setBulkDeleteOpen(false);
      setBulkBusy(false);
      await job.refreshJobs();
    }
  }

  // 일괄 다운로드 — 결정 2: 신규 ZIP endpoint. window.location.href 로
  // attachment 응답을 트리거 (개별 다운로드 링크와 동일 패턴). confirm 없음.
  function bulkDownload(ids: string[]) {
    if (ids.length === 0) return;
    const qs = new URLSearchParams({ ids: ids.join(','), format: 'docx' });
    window.location.href = `/api/transcripts/jobs/bulk-download?${qs.toString()}`;
    track('quotes_bulk_download_click', { count: ids.length });
  }

  // stuck 판정용 now — 30초마다 tick. stuck 잡은 30분+ 오래된 것이라 초 단위
  // 정밀도는 불필요. SSR/hydration: 첫 렌더엔 job.jobs 가 비어 있어(effect 로
  // 늦게 로드) 서버·클라 now 차이로 인한 불일치가 없다.
  const [stuckNow, setStuckNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setStuckNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Group jobs for the canvas card layout: in-flight 큐 vs 멈춤/실패 vs 완료.
  // 오래된 submitting/transcribing + 모든 error 는 stuck 으로 분리해 "진행 중"
  // 이 아니라 "멈춤/실패" 뱃지 + 재시도/삭제로 노출한다(무한 "진행 중" 제거).
  const doneJobs = job.jobs.filter((j) => j.status === 'done');
  const stuckJobs = job.jobs.filter(
    (j) => j.status !== 'done' && j.status !== 'cancelled' && isStuckJob(j, stuckNow),
  );
  const stuckIds = new Set(stuckJobs.map((j) => j.id));
  // 신선한(≤30분) queued/submitting/transcribing 만 "진행 중" 큐로. cancelled
  // (사용자 강제종료)는 terminal 이라 큐에서 제외 — 진행 프로그레스가 즉시 멈춘다.
  const queueJobs = job.jobs.filter(
    (j) => j.status !== 'done' && j.status !== 'cancelled' && !stuckIds.has(j.id),
  );
  const anyStuck = stuckJobs.length > 0;
  const hasUploads = Object.keys(job.localUploads).length > 0;
  // '시작' CTA — 업로드+언어확인까지 끝난 준비 파일이 있어야 활성.
  const readyCount = readyFiles.length;
  const canStart = readyCount > 0 && !busyUpload;

  // ─── 공정 과정 타임라인 (사용자 결정 R2/R3) ────────────────────────────────
  // 전사록은 backend 가 coarse status(queued/submitting/transcribing/done)만
  // 노출하고 md변환/화자분리/오탈자/표현보정 세부 phase 는 서버 내부에서만
  // 일어난다(§주의). 따라서 관측 가능한 upload/transcribe 만 active 로 두고,
  // 후처리 단계는 pending → 완료 시 done 으로 넘어가는 frontend estimate 를
  // 쓴다(가짜 active 상태 조작 없음). 멀티-파일 큐 UI 는 아래에 그대로 보존.
  // 신선한 inflight 만(stuck 제외 — queueJobs 는 이미 stuck/done 제외). stuck 은
  // 더 이상 "진행 중" 으로 세지 않아 StageFlow 가 멈춘 잡 때문에 영원히 돌지 않는다.
  const anyInflight = queueJobs.length > 0;
  // 진행 중(업로드/전사) — 컨트롤+CTA 자리를 타임라인이 대체.
  const txInflight = hasUploads || busyUpload || anyInflight;
  // 완료 — 진행 중 없음 + 재시도 대기 없음 + 멈춤/실패 없음 + 완료본 존재.
  // stuck 이 하나라도 있으면 무음 "완료" 로 넘어가지 않는다(완료 판정에 stuck 반영).
  const txDone =
    !txInflight && readyFiles.length === 0 && !anyStuck && doneJobs.length > 0;
  // fullview 후 idle 복귀(spec B) — idle 로 되돌린 뒤엔 완료 배너(✅ + 전체
  // 보기)를 접고 idle 컨트롤(언어 + 드롭존)만 노출한다. 완료 산출물은
  // DB/fullview 에 보존. phase 가 active 일 때만 done 프리젠테이션을 렌더.
  const showDone = txDone && phase === 'active';
  // 신선 inflight 중 대표 1건(StageFlow active idx). queueJobs 는 stuck 제외라
  // 멈춘 잡이 대표로 잡혀 플로우가 갇히는 회귀가 없다.
  const primaryInflight = queueJobs[0] ?? null;
  // ─── StageFlow 공정 플로우 (데스크 6노드 미러) ────────────────────────────
  // 전사록은 멀티파일 — N 파일 각자 status(queued/submitting/transcribing/done)
  // + 로컬 업로드 progress. 관측 가능한 업로드/전사만 실시간 active 로 두고,
  // 후처리 4단계(문서변환·화자분리·오탈자·표현보정)는 백엔드 세부 신호가 없어
  // reveal dwell 로 완료 직전 순서대로 노출한다(TX_STAGE_DEFS 참고). hint 로
  // 진행 세부(업로드 %, 전사 완료 N/M). 전 파일 done → complete=true 완료 hero.
  const uploadValues = Object.values(job.localUploads);
  const uploadingAvgPct =
    uploadValues.length > 0
      ? Math.round(
          uploadValues.reduce((s, v) => s + v, 0) / uploadValues.length,
        )
      : null;
  // 집계된 "실제" active 단계 인덱스: 로컬 업로드 progress 가 살아 있으면 0
  // (업로드), 그 외엔 전사 잡(primaryInflight) 또는 업로드 100% 직후 /start
  // 응답 대기 갭(busyUpload)을 1(전사)로 본다. 업로드 progress 가 사라진(=업로드
  // 끝난) 순간 바로 전사 노드로 넘겨, "업로드 노드에 갇혀 전사 진행이 안 보이는"
  // 갭 회귀를 막는다. 아무 신호 없으면 -1.
  const realActiveIdx = hasUploads
    ? 0
    : primaryInflight || busyUpload
      ? 1
      : -1;

  // ─── 타임드 스테이지 리빌 (데스크 STAGE_DWELL_MS 패턴) ─────────────────────
  // 업로드→전사 전이가 순식간이어도 각 단계를 최소 STAGE_DWELL_MS(≈5s) 노출한다.
  // 표시 인덱스(displayIdx)는 실제 단계(realActiveIdx)를 앞지르지 않되, 전 파일
  // 완료(txDone)면 남은 단계까지 걸어 보여준 뒤 완료 hero 로 넘어간다.
  const STAGE_DWELL_MS = 5000;
  const revealTarget = txDone ? TX_STAGE_COUNT : Math.max(realActiveIdx, 0);
  const [displayIdx, setDisplayIdx] = useState(0);
  const stageEnteredAtRef = useRef(0);
  // 새 업로드/전사 사이클이 더 앞 단계에서 시작되면(예: 완료 후 새 파일 추가)
  // 리빌을 그 단계로 되감아, 이전 완료 잔상을 지운다.
  useEffect(() => {
    if (realActiveIdx >= 0 && realActiveIdx < displayIdx) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- rewind reveal to a newly-started earlier stage
      setDisplayIdx(realActiveIdx);
      stageEnteredAtRef.current = Date.now();
    }
  }, [realActiveIdx, displayIdx]);
  // 한 번에 한 단계씩, 진입 후 최소 STAGE_DWELL_MS 지난 뒤에만 다음 단계로.
  useEffect(() => {
    if (displayIdx >= revealTarget) return;
    const wait = Math.max(
      0,
      STAGE_DWELL_MS - (Date.now() - stageEnteredAtRef.current),
    );
    const t = setTimeout(() => {
      stageEnteredAtRef.current = Date.now();
      setDisplayIdx((i) => i + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [displayIdx, revealTarget]);

  // 리빌이 아직 끝까지 안 걸어갔으면(완료여도) 플로우를 계속 보여준다. phase
  // active 일 때만 — fullview 후 idle 복귀(dismissed)면 컨트롤로 되돌린다.
  const revealFlowActive =
    phase === 'active' &&
    (txInflight || (txDone && displayIdx < TX_STAGE_COUNT));

  // StageFlow 노드 — status 는 실제 status 가 아니라 "표시" 인덱스(displayIdx)
  // 기준(리빌). active 단계에서만 hint: 업로드 % / 전사 완료 N/M. error 파일이
  // 있으면 현재 표시 단계를 error 톤으로. (useMemo 없이 plain — React Compiler
  // 가 자동 메모이즈. 데스크와 달리 파생 const 를 dep 로 두면 preserve-manual-
  // memoization 린트가 걸린다.)
  const txStages: Stage[] = TX_STAGE_DEFS.map((s, i) => {
    let status: Stage['status'];
    if (i < displayIdx) status = 'done';
    else if (i === displayIdx) status = anyStuck ? 'error' : 'active';
    else status = 'pending';
    // hint 는 관측 가능한 단계에만 — 업로드 % / 전사 완료 N/M. 후처리 4단계는
    // 백엔드 세부 신호가 없어 hint 없음(active glow + description 으로 안내).
    const hint =
      status !== 'active'
        ? undefined
        : s.id === 'upload'
          ? uploadingAvgPct != null
            ? `${uploadingAvgPct}%`
            : undefined
          : s.id === 'transcribe'
            ? job.jobs.length > 0
              ? `${doneJobs.length}/${job.jobs.length}`
              : undefined
            : undefined;
    return {
      id: s.id,
      label: tWidgets(s.label as never),
      status,
      icon: s.icon,
      description: tProcess(`transcripts.${s.phase}` as never),
      hint,
    };
  });

  // 헤더 pill 로 push 할 live state. 우선순위:
  //   1) 로컬 업로드 진행 중 → "UPLOADING NN%"
  //   2) 신선 전사 잡 inflight (submitting/transcribing/queued) → 가장 최근
  //      잡의 ETA 추정 진행률 + 라벨
  //   3) 멈춤/실패 잡 존재 → 'error'(warning 톤) — 무한 "진행 중" 오표시 제거
  //   4) 그 외 + done 잡 있음 → 'done'
  //   5) 그 외 → 'idle'
  const { setState } = useWidgetState();
  // uploadValues/uploadingAvgPct 는 StageFlow 블록에서 이미 계산 (헤더 pill 과
  // StageFlow 업로드 hint 가 같은 평균 진행률을 공유).
  const inflightJob = queueJobs[0] ?? null;
  // 멈춤/실패 대표 1건 — 헤더 pill 을 error 톤으로. 오래된 submitting(error 아님)
  // 도 여기서 잡아 헤더가 "진행 중" 으로 거짓 표시되지 않게 한다.
  const stuckJob = stuckJobs[0] ?? null;
  const stuckMessage = stuckJob?.error_message ?? null;
  // 1초마다 강제 tick — ETA 가 시간 기반이라 잡이 그대로여도 헤더 진행률이
  // 올라가야 한다. ProgressEstimate 와 동일 패턴 (별도 hook 으로 분리하면
  // 의존성 늘어 복잡 — 같은 컴포넌트 안에서 두 번 사용도 안전).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!inflightJob) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inflightJob]);
  useEffect(() => {
    if (uploadingAvgPct !== null) {
      setState({
        kind: 'running',
        label: 'UPLOADING',
        progress: uploadingAvgPct,
      });
      return;
    }
    if (inflightJob) {
      const label =
        inflightJob.status === 'uploading'
          ? 'UPLOADING'
          : inflightJob.status === 'queued'
            ? 'QUEUED'
            : inflightJob.status === 'submitting'
              ? 'SUBMITTING'
              : 'TRANSCRIBING';
      const progress = estimateTranscribeProgress(
        inflightJob.created_at,
        inflightJob.size_bytes,
        nowTick,
      );
      setState({ kind: 'running', label, progress });
      return;
    }
    if (stuckJob) {
      setState({
        kind: 'error',
        message: stuckMessage ?? undefined,
      });
      return;
    }
    // 완료 표면 세션 스코프(#187) 정합 — body 가 idle 휴식 얼굴(과거 done 만,
    // 세션 완료 0 → phase 'idle')이면 헤더도 idle 로 둔다. phase 가 active(세션
    // 내 완료/진행)일 때만 done 상태(및 raw 영문 'DONE' pill)를 노출해, fresh
    // 로그인 시 idle 컨트롤 보드 위에 헤더만 'DONE' 이 떠 어긋나던 잔상을 없앤다.
    // (widget-shell 공용 pill 은 무변경 — 이 위젯의 상태 보고만 세션 스코프.)
    if (doneJobs.length > 0 && phase === 'active') {
      setState({ kind: 'done' });
      return;
    }
    setState({ kind: 'idle' });
  }, [
    setState,
    uploadingAvgPct,
    inflightJob,
    stuckJob,
    stuckMessage,
    doneJobs.length,
    nowTick,
    phase,
  ]);

  // Analytics — 전사 잡의 완료/실패 전이 계측. 잡별 prev status 를 추적해
  // 실제 전이만 발화 — 마운트 시 로드되는 historical done/error 잡은 prev 가
  // 없어 계측하지 않는다. duration_ms 는 생성→완료관측 경과 (처리시간 근사).
  const transcribeStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const j of job.jobs) {
      const prev = transcribeStatusRef.current.get(j.id);
      transcribeStatusRef.current.set(j.id, j.status);
      if (!prev || prev === j.status) continue;
      if (j.status === 'done') {
        const durationMs = Math.max(
          0,
          Date.now() - new Date(j.created_at).getTime(),
        );
        trackEvent('job_completed', {
          widget: 'quotes',
          job_type: 'transcribe',
          duration_ms: durationMs,
        });
      } else if (j.status === 'error') {
        trackEvent('job_failed', {
          widget: 'quotes',
          job_type: 'transcribe',
          error: j.error_message ?? 'unknown_error',
        });
      }
    }
  }, [job.jobs]);

  const languageOptions = LANGUAGES.map((l) => ({
    value: l.code,
    label: `${l.flag} ${l.label}`,
  }));
  // 컨트롤 드롭다운 통일 — native <Select> → DropdownMenu(인터뷰 기준).
  // 항목/value/onChange 로직 불변, 껍데기만 교체 (spec 결정 3).
  const languageItems = languageOptions.map((o) => ({
    key: o.value,
    label: o.label,
    onSelect: () => setLanguage(o.value),
  }));
  const currentLanguageLabel =
    languageOptions.find((o) => o.value === language)?.label ?? language;

  // 전사 모드 카드 (ModeCardGroup #852 primitive 재사용, single). default
  // 리서치 = 현행. 회의록은 값만 저장 — 요약+Todo 결과물은 #485.
  const MODE_OPTIONS: { key: TranscriptMode; icon: string }[] = [
    { key: 'research', icon: '🎙️' },
    { key: 'meeting', icon: '📝' },
  ];
  const modeTitle: Record<TranscriptMode, string> = {
    research: tWidgets('transcriptModeResearch'),
    meeting: tWidgets('transcriptModeMeeting'),
  };

  // 발화자 수 드롭다운 (언어 옆). 1/2/3("3명 이상"). ControlTrigger 통일.
  const speakerOptions: { value: SpeakerCount; label: string }[] = [
    { value: 1, label: tWidgets('transcriptSpeaker1') },
    { value: 2, label: tWidgets('transcriptSpeaker2') },
    { value: 3, label: tWidgets('transcriptSpeaker3') },
  ];
  const speakerItems = speakerOptions.map((o) => ({
    key: String(o.value),
    label: o.label,
    onSelect: () => setSpeakerCount(o.value),
  }));
  const currentSpeakerLabel =
    speakerOptions.find((o) => o.value === speakerCount)?.label ?? '';

  // 컨트롤 패널 본체 — 위젯 메인 안에 상시 노출. 언어 드롭다운 + 인라인
  // 드래그드롭 dropzone (데스크/프로빙 컨트롤과 통일 — 업로드가 모달 뒤에
  // 숨지 않는다). 드롭/클릭 → startUploads → language-confirm → 업로드+자동
  // 전사. 언어 트리거 = DropdownMenu(aria-label) 라 Field htmlFor 불필요.
  const renderControls = () => (
    // 컨트롤↔dropzone 세로 간격 SSOT — 인터뷰(interviews-card) 와 동일하게
    // ControlBoardPanel gap="field"(gap-4=16px) 가 소유. 위젯 임의 space-y 금지.
    <>
      {/* 프로젝트 + 언어 + 발화자 수 — 한 행(#588). 프로빙 어시스턴트를 컨트롤
          간격 표준으로 통일(사용자 결정 2026-07-14): flex flex-wrap gap-4(16px) +
          프로젝트는 min-w 래퍼 없이 ProjectPicker 를 직접 배치해 콘텐츠 폭으로
          붙인다(옛 min-w-44 래퍼가 프로젝트 뒤 ~56px 빈 공간을 만들어 간격이
          벌어졌던 원인 — probing/control-board.tsx 와 동일 구조). 프로젝트는 위젯
          슬롯 'quotes' 의 독립 선택(프로빙/통역과 동일 ProjectPicker). 미선택(null)
          허용 — 프로젝트 없이도 전사 생성. 프로빙과 달리 "이 기기에만 저장" 안내
          카피는 넣지 않는다(#586 — 사용자가 그 문구를 싫어함). 언어/발화자수는
          프로빙과 동일하게 min-w-24 wrapper 로 하한폭 고정. 발화자 수는
          diarization hint 로 배선. 드롭다운 간 간격·정렬은
          ControlBoardPanel.Settings 슬롯 SSOT(SETTINGS_ROW_GAP + items-end) —
          손코딩 flex gap 제거. */}
      <ControlBoardPanel.Settings>
        <Field label={tView('fieldProject')}>
          <ProjectPicker
            widget="quotes"
            value={projectId}
            onChange={(id) => setSelection('quotes', id)}
          />
        </Field>

        <Field label={tView('fieldLanguage')}>
          <div className="min-w-24">
            <DropdownMenu
              items={languageItems}
              trigger={({ open, onClick, ...aria }) => (
                <ControlTrigger
                  {...aria}
                  data-open={open}
                  onClick={onClick}
                  aria-label={tView('fieldLanguage')}
                >
                  {currentLanguageLabel}
                </ControlTrigger>
              )}
            />
          </div>
        </Field>

        <Field label={tWidgets('transcriptSpeakerLabel')}>
          <div className="min-w-24">
            <DropdownMenu
              items={speakerItems}
              trigger={({ open, onClick, ...aria }) => (
                <ControlTrigger
                  {...aria}
                  data-open={open}
                  onClick={onClick}
                  aria-label={tWidgets('transcriptSpeakerLabel')}
                >
                  {currentSpeakerLabel}
                </ControlTrigger>
              )}
            />
          </div>
        </Field>
      </ControlBoardPanel.Settings>

      {/* 전사 모드 — 리서치(현행) / 회의록. ModeCardGroup(#852) single.
          라벨↔컨트롤 간격은 .Input(Field mb-1.5) SSOT. */}
      <ControlBoardPanel.Input label={tWidgets('transcriptModeLabel')}>
        <ModeCardGroup
          ariaLabel={tWidgets('transcriptModeLabel')}
          options={MODE_OPTIONS.map((opt) => ({
            key: opt.key,
            icon: opt.icon,
            label: modeTitle[opt.key],
          }))}
          value={mode}
          onChange={(key) => setMode(key as TranscriptMode)}
        />
      </ControlBoardPanel.Input>

      {/* 인라인 업로드 — 옛 📤 업로드 버튼 + 모달을 대체. 드래그드롭 + 클릭
          업로드 둘 다 primitive 가 지원. onDropRaw 로 워크스페이스 artifact
          드롭도 그대로 수용. .Region = 규격 프레임 + 콘텐츠(dropzone) 자유. */}
      <ControlBoardPanel.Region>
        <ControlDropzone
          accept={ACCEPT}
          multiple
          disabled={busyUpload}
          onFiles={(files) => startUploads(files)}
          onDropRaw={handleArtifactDrop}
          label={tUp('dropHere')}
          helperText={tUp('supported')}
        />
      </ControlBoardPanel.Region>

      {/* 직접 녹음 — 파일 업로드 대신 위젯에서 바로 마이크 녹음 (#503).
          정지 시 Blob→File 로 래핑해 startUploads 로 투입 → 파일 업로드와
          동일한 언어확인·업로드·전사 흐름(mode/발화자/언어)이 재사용된다. */}
      <ControlBoardPanel.Region>
        <TranscriptRecordButton
          disabled={busyUpload}
          onRecorded={(file) => startUploads([file])}
        />
      </ControlBoardPanel.Region>

      {uploadError ? (
        <p className="text-sm text-warning">{uploadError}</p>
      ) : readyCount > 0 ? (
        <p className="text-xs text-mute">
          {tWidgets('transcriptReadyHint', { count: readyCount })}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      {/* 본문 — chrome 과 헤더는 widget-shell 책임. 서브헤더 slim bar 폐기:
            · 컨트롤 패널 = 상단에 phase 무관 항상 노출 (언어 + 📤 업로드 CTA)
            · 산출물(업로드 진행/큐/상태) = 그 아래 별 영역, active 시만
          업로드 모달은 항상 마운트. */}
      <div className="flex h-full flex-col">
        {/* 컨트롤 패널 — 실행 중이라도 언어 재설정·새 파일 업로드가 가능하도록
            항상 노출. idle(산출물 없음) 에는 카드 정중앙(수직+수평 center)에
            띄워 통일 launcher 룩 (데스크/프로빙 기준 — 사용자 결정 2026-07-06).
            active 진입 시 상단 고정 + 아래 산출물. */}
        <ControlBoardPanel active={phase === 'active'} gap="field">
          {revealFlowActive ? (
              // active: 컨트롤+CTA 완전 대체 → StageFlow 공정 플로우차트 hero
              // (사용자 결정 3, 데스크 미러). 좁은 카드 대응 vertical. per-file
              // 상세(업로드/큐 JobProgress)는 아래 산출물 영역의 "파일별 상세"
              // 접기로 강등된다. 완료 후에도 리빌이 끝까지 안 걸어갔으면 계속 노출.
              <div className="flex flex-col items-center gap-5 py-6">
                <StageFlow
                  stages={txStages}
                  orientation="vertical"
                  className="w-full max-w-xs"
                />
                {/* STOP — 진행 중 전사 강제종료 (데스크 미러). 실제 전사 잡이
                    inflight 일 때만 노출(업로드-only 구간엔 취소 대상이 없음). */}
                {queueJobs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancelInflight()}
                    disabled={stopping}
                  >
                    {stopping ? tWidgets('transcriptStopRequested') : tWidgets('transcriptStop')}
                  </Button>
                )}
              </div>
            ) : showDone ? (
              // done: StageFlow 완료 hero + "결과 보기" CTA (사용자 결정 3) →
              // fullview 진입. 파일 추가 업로드 경로(dropzone + 녹음)는 hero
              // 아래 보존 — 완료 상태에서도 새 전사를 이어서 시작할 수 있다.
              <div className="flex flex-col items-center gap-6 py-4">
                <StageFlow
                  stages={txStages}
                  complete
                  completeLabel={tProcess('completeTitle')}
                  onResult={handleQuotesFullview}
                  resultLabel={tWidgets('viewAll')}
                />
                {/* 파일 추가 업로드 경로 — 인라인 dropzone (idle 컨트롤과 동일
                    핸들러). 드롭/클릭 → 새 전사 flow. */}
                <div className="w-full space-y-4">
                  <ControlDropzone
                    accept={ACCEPT}
                    multiple
                    disabled={busyUpload}
                    onFiles={(files) => startUploads(files)}
                    onDropRaw={handleArtifactDrop}
                    label={tUp('dropHere')}
                    helperText={tUp('supported')}
                  />
                  {/* 완료 상태에서도 직접 녹음으로 새 전사 추가 (#503). */}
                  <TranscriptRecordButton
                    disabled={busyUpload}
                    onRecorded={(file) => startUploads([file])}
                  />
                </div>
              </div>
            ) : (
              renderControls()
            )}
        </ControlBoardPanel>

        {/* 산출물 영역 — active(실행 중/완료) 일 때만. idle 에는 컨트롤만
            노출되고 이 영역은 렌더되지 않는다. */}
        {phase === 'active' && (
          <>
            {/* 멈춤 / 실패 — 오래된 submitting/transcribing + error. 접힘 상세가
                아니라 항상 펼쳐 노출한다(조용한 실패 = 유저 데이터 유실 인지 불가
                라 눈에 띄어야 함). 각 행은 warning 뱃지 + 재시도(기존 storage_key
                재전사) / 삭제. */}
            {stuckJobs.length > 0 && (
              <WidgetOutputRegion padY="lg">
                <div className="mb-2 flex items-center justify-between">
                  <SectionLabel>{tWidgets('transcriptStuckSection')}</SectionLabel>
                  <span className="text-xs text-warning">{tView('countItems', { count: stuckJobs.length })}</span>
                </div>
                <p className="mb-3 text-xs text-mute-soft">
                  {tWidgets('transcriptStuckHint')}
                </p>
                <ul className="space-y-3">
                  {stuckJobs.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      stuck
                      onRetry={() => void retryJob(j.id)}
                      onDelete={() => deleteJob(j.id)}
                    />
                  ))}
                </ul>
              </WidgetOutputRegion>
            )}

            {/* 업로드 진행 + 큐. flex-1 로 산출물을 채우고, 길어지면 자체
                스크롤. 수평 여백·클러스터(컨트롤 좌측 정합)는 WidgetOutputRegion
                SSOT 소유 — 손코딩 px 금지. */}
            {/* per-file 상세 — StageFlow 가 hero(위 컨트롤 영역)라, 파일별
                업로드/큐 진행 막대는 보조로 강등하고 기본 접힘(사용자 결정 3,
                데스크 진행 로그 패턴). 접기 안에 업로드 진행 + 큐 리스트 +
                전사 시작 갭 indeterminate 바를 모두 담는다. 표시할 상세가 하나도
                없으면 details 자체를 렌더하지 않는다. */}
            {(hasUploads ||
              queueJobs.length > 0 ||
              (busyUpload && queueJobs.length === 0)) && (
              <WidgetOutputRegion padY="lg">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[.18em] text-mute-soft">
                    <span>{tWidgets('transcriptStageDetails')}</span>
                    <span className="tabular-nums normal-case tracking-normal">
                      {tView('countItems', {
                        count: Object.keys(job.localUploads).length + queueJobs.length,
                      })}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-5">
                    {hasUploads && (
                      <div>
                        <SectionLabel>{tCommon('uploading')}</SectionLabel>
                        <ul className="mt-2 space-y-2">
                          {Object.entries(job.localUploads).map(([id, pct]) => (
                            <li key={id}>
                              <JobProgress value={pct} label={tCommon('uploadingFiles')} variant="inline" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {queueJobs.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <SectionLabel>{tView('queueInProgress')}</SectionLabel>
                          <span className="text-xs text-mute-soft">{tView('countItems', { count: queueJobs.length })}</span>
                        </div>
                        <ul className="space-y-3">
                          {queueJobs.map((j) => (
                            <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 전사 시작 갭 — 업로드 100% 후 /api/transcripts/start 응답을
                        기다리는 동안엔 잡이 아직 job.jobs 에 없어 위 큐가 비어 있다.
                        이 구간에도 진행 신호를 잃지 않도록 indeterminate 바를 노출
                        (업로드 진행 중이거나 이미 큐에 잡이 뜬 경우는 제외). */}
                    {busyUpload && !hasUploads && queueJobs.length === 0 && (
                      <div>
                        <SectionLabel>{tView('inProgress')}</SectionLabel>
                        <div className="mt-2">
                          <JobProgress label={tCommon('transcribing')} variant="inline" />
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              </WidgetOutputRegion>
            )}

            {/* 상태 푸터 — 진행중(업로드/전사 시작/전사 inflight)이면 "전사가
                진행중", 완료본만 있으면 "전사가 완료되었습니다"(클릭 → fullview).
                진행중이 완료보다 우선. `busyUpload` 포함이 핵심: 업로드 100% 직후
                /api/transcripts/start 응답을 기다리는 갭(잡이 아직 job.jobs 에
                안 뜬 구간) 동안에도 running 을 유지해, 이전 완료본이 있어도
                "완료" 로 오표시하지 않는다. 시작 실패로 readyFiles 에 남은
                대기분이 있으면(pending-retry) 완료로 오인시키지 않고 푸터를
                숨긴다 — slim bar 재확장의 재시도 CTA + 에러 hint 가 신호를 담당. */}
            {(() => {
              // 신선 inflight 만(queueJobs = stuck/done 제외). 멈춘 잡이 "진행중"
              // 푸터를 무한히 띄우던 회귀를 막는다.
              const running = hasUploads || busyUpload || queueJobs.length > 0;
              if (running) {
                return (
                  <WidgetStatusFooter
                    status="running"
                    label={tWidgets('transcriptRunning')}
                    viewAllLabel={tWidgets('viewAll')}
                    count={doneJobs.length}
                    resetKey="running"
                    onClick={handleQuotesFullview}
                  />
                );
              }
              // done 블록(컨트롤 영역)이 이미 "전체 보기" CTA 를 제공하므로
              // 하단 완료 푸터는 생략 — 중복 CTA 회피.
              if (txDone) return null;
              // 멈춤/실패 잡이 있으면 완료로 오인시키지 않는다 — 위 멈춤 섹션이
              // 신호를 담당(재시도/삭제). pending-retry 도 동일.
              if (anyStuck) return null;
              if (readyFiles.length > 0 || doneJobs.length === 0) return null;
              return (
                <WidgetStatusFooter
                  status="done"
                  label={tWidgets('transcriptDone')}
                  viewAllLabel={tWidgets('viewAll')}
                  count={doneJobs.length}
                  resetKey={`done-${doneJobs.length}`}
                  onClick={handleQuotesFullview}
                />
              );
            })()}
          </>
        )}

        {/* 주 CTA — 바디 최하단 고정 액션 바 (6 위젯 통일, 위치는 bottom-bar
            spec 소유). 컨트롤 phase 에서만 노출(진행 timeline / 완료 done 은
            숨김). 업로드는 인라인 dropzone 이 담당하므로 하단 바는 항상
            "전사 시작" — 준비 파일 없으면 disabled, 있으면(자동 시작 실패
            재시도분) 활성. */}
        {!txInflight && !showDone && (
          <WidgetPrimaryCta
            label={
              readyCount > 0
                ? `${tWidgets('transcriptStart')} (${readyCount})`
                : tWidgets('transcriptStart')
            }
            busyLabel={tCommon('loading')}
            busy={busyUpload}
            disabled={!canStart}
            onClick={() => void startTranscription()}
          />
        )}
      </div>

      {pendingFiles && (
        <LanguageConfirmDialog
          files={pendingFiles}
          language={language}
          onLanguageChange={setLanguage}
          onConfirm={confirmPendingUpload}
          onCancel={cancelPendingUpload}
        />
      )}

      {/* 통일 "전체 보기" — 전사 작업 전체(진행 중 + 완료)를 풀스크린 list +
          파일명 검색으로. JobRow previewMode="inline" 이라 모달 안에서도
          다운로드/공유/미리보기/삭제 모두 동작. 공유 모달 slot 으로 portal. */}
      {renderInSlot(
        <WidgetFullviewPanel
          title={tView('fullviewTitle')}
          subtitle={
            tView('fullviewSubtitle', {
              done: doneJobs.length,
              queue: queueJobs.length,
            }) +
            (stuckJobs.length > 0
              ? tView('fullviewSubtitleStuck', { stuck: stuckJobs.length })
              : '')
          }
          onClose={closeFullview}
        >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col px-6 py-6">
          <div className="mb-4 shrink-0">
            <Input
              fullWidth
              value={fullviewQuery}
              onChange={(e) => setFullviewQuery(e.target.value)}
              placeholder={tView('searchPlaceholder')}
              aria-label={tView('searchAria')}
            />
          </div>
          {(() => {
            const q = fullviewQuery.trim().toLowerCase();
            const list = (q
              ? job.jobs.filter((j) =>
                  (j.filename ?? '').toLowerCase().includes(q),
                )
              : job.jobs
            ).slice();
            if (list.length === 0) {
              return (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <p className="py-10 text-center text-md text-mute-soft">
                    {q ? tView('noSearchResults') : tView('noJobs')}
                  </p>
                </div>
              );
            }
            // 전체 선택 상태 — 현재 보이는(검색 필터 적용된) 목록 기준.
            const visibleIds = list.map((j) => j.id);
            const selectedVisible = visibleIds.filter((id) => selected.has(id));
            const allSelected =
              visibleIds.length > 0 &&
              selectedVisible.length === visibleIds.length;
            const someSelected =
              selectedVisible.length > 0 && !allSelected;
            const selectedList = Array.from(selected);
            return (
              <>
                {/* 헤더 — 전체 선택 체크박스. bulk toolbar 는 바로 아래에 뜬다. */}
                <div className="mb-2 flex shrink-0 items-center gap-3 px-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-mute">
                    <Checkbox
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? new Set(visibleIds) : new Set(),
                        )
                      }
                      aria-label={tView('selectAll')}
                    />
                    {tView('selectAll')}
                  </label>
                </div>

                {/* Bulk toolbar — 선택 1개 이상일 때만 노출. 목록 스크롤 영역
                    밖(shrink-0)이라 스크롤해도 항상 보인다. 다운로드는 confirm
                    없이 바로, 삭제는 confirm 모달(결정 3). */}
                {selected.size > 0 && (
                  <div className="mb-3 flex shrink-0 items-center gap-3 border-2 border-line-soft bg-amore-bg px-4 py-2 rounded-sm">
                    <span className="text-sm font-semibold text-ink-2">
                      {tView('nSelected', { count: selected.size })}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={clearSelection}
                      >
                        {tView('clearSelection')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => bulkDownload(selectedList)}
                      >
                        {tView('zipDownload', { count: selected.size })}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBulkDeleteOpen(true)}
                        disabled={bulkBusy}
                      >
                        {tView('bulkDeleteBtn', { count: selected.size })}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ul className="space-y-3">
                    {list.map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        stuck={isStuckJob(j, stuckNow)}
                        onRetry={() => void retryJob(j.id)}
                        onDelete={() => deleteJob(j.id)}
                        previewMode="inline"
                        selectable
                        selected={selected.has(j.id)}
                        onToggleSelect={(on) => toggleSelect(j.id, on)}
                      />
                    ))}
                  </ul>
                </div>
              </>
            );
          })()}
        </div>
        </WidgetFullviewPanel>,
      )}

      {/* 일괄 삭제 confirm 모달 — 결정 3. */}
      <Modal
        open={bulkDeleteOpen}
        onClose={() => (bulkBusy ? undefined : setBulkDeleteOpen(false))}
        title={tView('bulkDeleteModalTitle')}
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-md leading-[1.7] text-mute">
            {tView.rich('bulkDeleteConfirmBody', {
              count: selected.size,
              b: (chunks) => (
                <span className="font-semibold text-ink-2">{chunks}</span>
              ),
            })}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkBusy}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              size="md"
              onClick={() => void bulkDelete(Array.from(selected))}
              disabled={bulkBusy}
            >
              {bulkBusy
                ? tView('deleting')
                : tView('deleteCount', { count: selected.size })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// 카드 헤더의 상태 pill — running/error/idle
// stateBadge 는 widget-shell 측에서 statePill (tokens.ts) 로 그림 — body 안에서는 제거.

// Gates every transcript upload on an explicit language confirmation.
// The selector inside the modal writes back to the same state as the
// top-of-page dropdown so a change here also persists for subsequent
// uploads in the same session.
function LanguageConfirmDialog({
  files,
  language,
  onLanguageChange,
  onConfirm,
  onCancel,
}: {
  files: File[];
  language: string;
  onLanguageChange: (lang: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('Features.transcriptsView.languageConfirm');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onCancel]);

  // Portal to document.body so the modal's `fixed` positioning resolves
  // against the viewport, not the canvas surface (which has a `transform`
  // that would otherwise become the containing block for fixed children —
  // see CSS Transforms §6).
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-ink/30 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] border border-line bg-paper p-8 rounded-sm"
      >
        <h2 className="text-2xl font-semibold tracking-[-0.012em] text-ink-2">
          {t('title')}
        </h2>
        <p className="mt-2 text-md leading-[1.7] text-mute">
          {t('body')}
        </p>

        <div className="mt-6">
          <Field label={t('languageLabel')} htmlFor="transcript-language-confirm">
            {/* Select 프리미티브 — 표피 통일(DS-3). Field 가 라벨을 소유하므로
                프리미티브 자체 label 은 미전달(중복 방지). id 는 Field 의
                htmlFor 연결 유지. md 사이즈 = 옛 native px-3 py-2 text-lg
                rounded-sm border-line/focus:border-ink 와 동치. */}
            <Select
              id="transcript-language-confirm"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              autoFocus
              options={LANGUAGES.map((l) => ({
                value: l.code,
                label: `${l.flag} ${l.label} (${l.code})`,
              }))}
            />
          </Field>
        </div>

        <p className="mt-4 text-sm text-mute-soft">
          {files.length === 1
            ? t('fileCountSingular')
            : t('fileCountPlural', { count: files.length })}
        </p>

        <div className="mt-7 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={onCancel}
            className="uppercase tracking-[0.18em]"
          >
            {t('cancelCta')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onConfirm}
            className="uppercase tracking-[0.18em]"
          >
            {t('proceedCta')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Audit slice attached to `raw_result._cleanup` by the cleanup pass. We only
// read these three fields in the UI — kept inline so we don't import the
// server-only `cleanup.ts` module from a client component.
type PreviewCleanupAudit = {
  chunks_applied?: number;
  turns_total?: number;
  turns_touched?: number;
};

// Audit slice for the Q&A diarization pass (raw_result._diarization).
type PreviewDiarizationAudit = {
  confidence?: 'high' | 'medium' | 'low';
  turns?: number;
};

type TranscriptSource = 'clean' | 'raw';

function JobRow({
  job,
  onDelete,
  onRetry,
  stuck = false,
  previewMode = 'modal',
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  job: TranscriptJob;
  onDelete: () => void;
  // 멈춤/실패 잡 재시도. stuck=true 일 때만 렌더된다.
  onRetry?: () => void;
  // 멈춤/실패(오래된 submitting/transcribing + error). 뱃지를 warning 톤 "멈춤"
  // 으로 바꾸고 재시도 버튼을 노출하며, 거짓 진행률(ProgressEstimate)을 숨긴다.
  stuck?: boolean;
  // 'modal' = 카드 안 (default) — 미리보기 클릭 시 Modal 팝업.
  // 'inline' = "더보기" 모달 안 — 기존 expand 동작 유지 (nested modal 회피).
  previewMode?: 'modal' | 'inline';
  // fullview 일괄 선택용. selectable=false (default) 면 체크박스 미노출 —
  // 카드 안 큐/산출물 목록은 기존 그대로.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (on: boolean) => void;
}) {
  const tView = useTranslations('Features.transcriptsView');
  const [previewOpen, setPreviewOpen] = useState(false);
  // Default to the cleaned version — preview/download routes also default to
  // 'clean' so behaviour matches when the toggle hasn't been touched.
  const [source, setSource] = useState<TranscriptSource>('clean');
  // `previewMeta` is populated by JobPreview's first response (the only place
  // we know whether `clean_markdown` actually landed). DownloadMenu reads it
  // to decide whether to bother appending the `?source=raw` query.
  const [previewMeta, setPreviewMeta] = useState<{
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
    hasInferredSpeakers: boolean;
    diarizationAudit: PreviewDiarizationAudit | null;
  } | null>(null);
  // 멈춤이면 status pill 을 warning 톤 "멈춤" 으로. 실제 error 는 pillFor 가 이미
  // "오류"(warning) 라 그대로, 오래된 submitting/transcribing 은 amore "제출 중/
  // 전사 중" 대신 "멈춤" 으로 덮어 무한 진행 오표시를 없앤다.
  const pill =
    stuck && job.status !== 'error'
      ? { text: tView('stuckPill'), cls: 'text-warning' }
      : pillFor(job.status, tView);
  // 멈춘 잡은 실제로 진전이 없으므로 거짓 ETA 막대(ProgressEstimate)를 숨긴다.
  const inFlight =
    !stuck &&
    (job.status === 'submitting' || job.status === 'transcribing');
  // Only thread the source query through the download URL when the user has
  // explicitly switched to raw — keeps existing share links / bookmarks valid.
  const downloadSuffix = source === 'raw' ? '?source=raw' : '';

  return (
    <WidgetOutputRow
      title={job.filename}
      leading={
        selectable ? (
          <Checkbox
            checked={selected}
            onChange={(e) => onToggleSelect?.(e.target.checked)}
            aria-label={tView('selectAria', { filename: job.filename })}
          />
        ) : undefined
      }
      meta={
        <>
          <span
            className={`uppercase tracking-[0.22em] text-xs font-semibold ${pill.cls}`}
          >
            {pill.text}
          </span>
          {job.size_bytes !== null && <span>{formatBytes(job.size_bytes)}</span>}
          {job.duration_seconds !== null && (
            <span>{formatDuration(job.duration_seconds)}</span>
          )}
          {job.speakers_count !== null && (
            <span>{job.speakers_count} speakers</span>
          )}
          {job.error_message && (
            <span className="text-warning">{job.error_message}</span>
          )}
        </>
      }
      extra={
        inFlight ? (
          <ProgressEstimate
            startedAt={job.created_at}
            sizeBytes={job.size_bytes}
          />
        ) : null
      }
      actions={
        <>
          {job.status === 'done' && (
            <div className="flex items-center gap-2">
              <DownloadMenu
                tone="primary"
                align="end"
                onExport={(format) =>
                  track('quotes_download_click', { format, jobId: job.id })
                }
                items={[
                  {
                    format: 'docx',
                    kind: 'url',
                    href: `/api/transcripts/jobs/${job.id}/download/docx${downloadSuffix}`,
                  },
                  {
                    format: 'md',
                    kind: 'url',
                    href: `/api/transcripts/jobs/${job.id}/download/md${downloadSuffix}`,
                  },
                  {
                    format: 'txt',
                    kind: 'url',
                    href: `/api/transcripts/jobs/${job.id}/download/txt${downloadSuffix}`,
                  },
                ]}
              />
              <ShareMenu
                align="end"
                items={[
                  {
                    destination: 'google-docs',
                    title: job.filename || tView('transcriptFallbackTitle'),
                    // Reuse the server-built DOCX so Google Doc preserves
                    // the same rich layout users see in the .docx download.
                    getBlob: async () => {
                      const r = await fetch(
                        `/api/transcripts/jobs/${job.id}/download/docx${downloadSuffix}`,
                      );
                      return {
                        blob: await r.blob(),
                        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      };
                    },
                  },
                ]}
              />
              <Button
                variant="link"
                size="sm"
                onClick={() => setPreviewOpen((v) => !v)}
                className="uppercase tracking-[0.18em]"
              >
                {previewMode === 'inline' && previewOpen
                  ? tView('collapse')
                  : tView('preview')}
              </Button>
            </div>
          )}
          {stuck && onRetry && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetry}
              className="uppercase tracking-[0.18em]"
            >
              {tView('retry')}
            </Button>
          )}
          <IconButton
            variant="ghost-danger"
            aria-label={tView('deleteJobAria')}
            onClick={onDelete}
            className="text-sm"
          >
            ✕
          </IconButton>
        </>
      }
    >
      {previewMode === 'inline' && previewOpen && job.status === 'done' && (
        <JobPreview
          id={job.id}
          source={source}
          setSource={setSource}
          onMeta={setPreviewMeta}
          initialMeta={previewMeta}
        />
      )}
      {previewMode === 'modal' && job.status === 'done' && (
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={job.filename}
          size="lg"
        >
          <JobPreview
            id={job.id}
            source={source}
            setSource={setSource}
            onMeta={setPreviewMeta}
            initialMeta={previewMeta}
          />
        </Modal>
      )}
    </WidgetOutputRow>
  );
}

function JobPreview({
  id,
  source,
  setSource,
  onMeta,
  initialMeta,
}: {
  id: string;
  source: TranscriptSource;
  setSource: (s: TranscriptSource) => void;
  onMeta: (m: {
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
    hasInferredSpeakers: boolean;
    diarizationAudit: PreviewDiarizationAudit | null;
  }) => void;
  initialMeta: {
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
    hasInferredSpeakers: boolean;
    diarizationAudit: PreviewDiarizationAudit | null;
  } | null;
}) {
  const tView = useTranslations('Features.transcriptsView');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the first fetch lands, we can still render the toggle if the
  // parent has cached meta from a prior open — avoids the toggle blinking out
  // when the user toggles and we're refetching.
  const [meta, setMeta] = useState<{
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
    hasInferredSpeakers: boolean;
    diarizationAudit: PreviewDiarizationAudit | null;
  } | null>(initialMeta);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    setHtml(null);
    setError(null);
    fetch(`/api/transcripts/jobs/${id}/preview?source=${source}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `preview ${r.status}`);
        }
        return r.json();
      })
      .then(
        (j: {
          html: string;
          hasCleanVersion?: boolean;
          cleanupAudit?: PreviewCleanupAudit | null;
          hasInferredSpeakers?: boolean;
          diarizationAudit?: PreviewDiarizationAudit | null;
        }) => {
          if (cancelled) return;
          setHtml(j.html ?? '');
          const next = {
            hasCleanVersion: !!j.hasCleanVersion,
            cleanupAudit: j.cleanupAudit ?? null,
            hasInferredSpeakers: !!j.hasInferredSpeakers,
            diarizationAudit: j.diarizationAudit ?? null,
          };
          setMeta(next);
          onMeta(next);
        },
      )
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'fetch_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [id, source, onMeta]);

  const showToggle = meta?.hasCleanVersion === true;
  const touched = meta?.cleanupAudit?.turns_touched;
  const total = meta?.cleanupAudit?.turns_total;
  const showInferredBadge = meta?.hasInferredSpeakers === true;

  return (
    <div className="border-t border-line-soft px-5 pb-4 pt-3">
      {showInferredBadge && (
        <div
          className="mb-3 flex items-start gap-2 border border-line-soft bg-paper-soft px-3 py-2 text-xs text-mute rounded-sm"
          title={tView('inferredSpeakersHint')}
        >
          <span aria-hidden>✨</span>
          <span>{tView('inferredSpeakersBadge')}</span>
        </div>
      )}
      {showToggle && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant={source === 'clean' ? 'primary' : 'ghost'}
              size="xs"
              onClick={() => setSource('clean')}
              className="uppercase tracking-[0.18em]"
            >
              {tView('cleanVersion')}
            </Button>
            <Button
              variant={source === 'raw' ? 'primary' : 'ghost'}
              size="xs"
              onClick={() => setSource('raw')}
              className="uppercase tracking-[0.18em]"
            >
              {tView('rawVersion')}
            </Button>
          </div>
          {typeof touched === 'number' && typeof total === 'number' && (
            <div className="text-xs-soft text-mute-soft tabular-nums">
              {tView('correctionCount', { touched, total })}
            </div>
          )}
        </div>
      )}
      {error ? (
        <div className="text-sm text-warning">{error}</div>
      ) : html === null ? (
        <div className="text-sm text-mute-soft">{tView('loadingPreview')}</div>
      ) : (
        <div
          className="docx-preview max-h-[400px] overflow-y-auto text-md leading-[1.7] text-ink-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

// 헤더 pill 과 ProgressEstimate row 가 공유하는 ETA 계산. Deepgram async
// API 가 progress 를 안 줘서 file-size 기반 heuristic — 1.5s / MB, 30s
// floor, 30min ceiling. 95% 에서 cap 해서 webhook 도착 전에 100% 라고
// 거짓말 안 함.
function estimateTranscribeProgress(
  startedAt: string,
  sizeBytes: number | null,
  nowMs: number,
): number {
  const startMs = new Date(startedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const sizeMb = sizeBytes ? sizeBytes / (1024 * 1024) : 0;
  const etaSec = Math.max(30, Math.min(30 * 60, Math.round(sizeMb * 1.5)));
  return Math.min(95, Math.round((elapsedSec / etaSec) * 100));
}

/**
 * Deepgram async API doesn't expose progress, so this is a heuristic ETA bar.
 * We show elapsed time honestly and a *推定* fill driven by file size, capped
 * at 95% so it never claims to be done before the webhook lands.
 */
function ProgressEstimate({
  startedAt,
  sizeBytes,
}: {
  startedAt: string;
  sizeBytes: number | null;
}) {
  const tCommon = useTranslations('Common');
  const tView = useTranslations('Features.transcriptsView');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));

  const sizeMb = sizeBytes ? sizeBytes / (1024 * 1024) : 0;
  const etaSec = Math.max(30, Math.min(30 * 60, Math.round(sizeMb * 1.5)));
  const remainSec = Math.max(0, etaSec - elapsedSec);
  const pct = estimateTranscribeProgress(startedAt, sizeBytes, now);

  return (
    <div className="mt-2">
      <JobProgress
        value={pct}
        label={tCommon('transcribing')}
        hint={tView('transcribingEta', {
          elapsed: formatClock(elapsedSec),
          remain: formatClock(remainSec),
        })}
        variant="inline"
      />
    </div>
  );
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pillFor(
  status: TranscriptJobStatus,
  t: ReturnType<typeof useTranslations>,
): { text: string; cls: string } {
  switch (status) {
    case 'uploading':
      return { text: t('statusUploading'), cls: 'text-amore' };
    case 'queued':
      return { text: t('statusQueued'), cls: 'text-mute-soft' };
    case 'submitting':
      return { text: t('statusSubmitting'), cls: 'text-amore' };
    case 'transcribing':
      return { text: t('statusTranscribing'), cls: 'text-amore' };
    case 'done':
      return { text: t('statusDone'), cls: 'text-amore' };
    case 'error':
      return { text: t('statusError'), cls: 'text-warning' };
    case 'cancelled':
      return { text: t('statusCancelled'), cls: 'text-mute-soft' };
  }
}
