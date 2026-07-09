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
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { IconButton } from '@/components/ui/icon-button';
import { Checkbox } from '@/components/ui/checkbox';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { ControlDropzone } from '@/components/ui/control-dropzone';
import { TranscriptRecordButton } from '@/components/canvas/widgets/transcript-record-button';
import { JobProgress } from '@/components/ui/job-progress';
import {
  ProcessTimeline,
  buildLinearPhases,
} from '@/components/ui/process-timeline';
import { Input } from '@/components/ui/input';
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

function readActiveProjectId(): string | null {
  try {
    const raw = window.localStorage.getItem('active_project:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string } | null;
    return parsed?.id ?? null;
  } catch {
    return null;
  }
}

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
  const requireAuth = useRequireAuth();
  const { user } = useAuth();
  // 영속 dismissal 키 스코프 (계정별). 로그아웃/계정 전환 시 자동으로 다른
  // 키를 보게 되어 이전 계정의 idle 복귀가 섞이지 않는다.
  const userId = user?.id ?? null;
  const job = useTranscriptJobs();
  const workspace = useWorkspace();
  const toast = useToast();

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
    // 완료분만 있는 상태: fullview 확인 후 idle 로 되돌린 게 아니면
    // (첫 로드/새로고침 등) active 로 승격.
    if (job.jobs.length > 0) {
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
  }, [job.jobs, job.localUploads, readyFiles.length, userId]);

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
        try {
          job.setUploadProgress(tempId, 0);

          // 1) ask server for a signed upload URL
          const urlRes = await fetch('/api/transcripts/upload-url', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ filename: file.name }),
          });
          if (!urlRes.ok) {
            const err = await urlRes.json().catch(() => ({}));
            throw new Error(err.error ?? `upload-url ${urlRes.status}`);
          }
          const { upload_url, storage_key } = (await urlRes.json()) as {
            upload_url: string;
            storage_key: string;
          };

          // 2) PUT the file to Supabase Storage with progress
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', upload_url);
            if (file.type) xhr.setRequestHeader('content-type', file.type);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                job.setUploadProgress(
                  tempId,
                  Math.round((e.loaded / e.total) * 100),
                );
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
              }
              const detail = (xhr.responseText || '').slice(0, 300);
              reject(
                new Error(
                  detail
                    ? `storage upload ${xhr.status}: ${detail}`
                    : `storage upload ${xhr.status}`,
                ),
              );
            };
            xhr.onerror = () => reject(new Error('upload network error'));
            xhr.send(file);
          });
          job.setUploadProgress(tempId, 100);

          // 3) 업로드 성공 — 언어는 확인 시점 값으로 고정해 적재. 루프 종료 후
          //    한꺼번에 자동 전사 시작.
          uploaded.push({
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
    setUploadError(null);
    const queue = [...files];
    try {
      while (queue.length > 0) {
        const rf = queue[0];
        const startRes = await fetch('/api/transcripts/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            storage_key: rf.storage_key,
            filename: rf.filename,
            mime_type: rf.mime_type,
            size_bytes: rf.size_bytes,
            language: rf.language,
            project_id: readActiveProjectId(),
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
    if (!confirm('이 전사 작업을 삭제할까요?')) return;
    const res = await fetch(`/api/transcripts/jobs/${id}`, { method: 'DELETE' });
    if (res.ok) job.removeJob(id);
    await job.refreshJobs();
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
        toast.push(`${succeeded}개 삭제 완료`, { tone: 'info' });
      } else {
        toast.push(`${succeeded}개 성공 · ${failed}개 실패`, { tone: 'warn' });
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

  // Group jobs for the canvas card layout: in-flight 큐 vs 완료된 산출물.
  // pillFor 가 보는 status 5종 중 'done' 만 recents 로, 나머지는 queue 로.
  const queueJobs = job.jobs.filter((j) => j.status !== 'done');
  const doneJobs = job.jobs.filter((j) => j.status === 'done');
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
  const anyInflight = job.jobs.some(
    (j) =>
      j.status === 'queued' ||
      j.status === 'submitting' ||
      j.status === 'transcribing',
  );
  const anyError = job.jobs.some((j) => j.status === 'error');
  // 진행 중(업로드/전사) — 컨트롤+CTA 자리를 타임라인이 대체.
  const txInflight = hasUploads || busyUpload || anyInflight;
  // 완료 — 진행 중 없음 + 재시도 대기 없음 + 에러 없음 + 완료본 존재.
  const txDone =
    !txInflight && readyFiles.length === 0 && !anyError && doneJobs.length > 0;
  // fullview 후 idle 복귀(spec B) — idle 로 되돌린 뒤엔 완료 배너(✅ + 전체
  // 보기)를 접고 idle 컨트롤(언어 + 드롭존)만 노출한다. 완료 산출물은
  // DB/fullview 에 보존. phase 가 active 일 때만 done 프리젠테이션을 렌더.
  const showDone = txDone && phase === 'active';
  const primaryInflight =
    job.jobs.find(
      (j) =>
        j.status === 'queued' ||
        j.status === 'submitting' ||
        j.status === 'transcribing',
    ) ?? null;
  const TX_PHASES = [
    'uploading',
    'transcribing',
    'md_conversion',
    'speaker_diarization',
    'typo_correction',
    'phrasing_polish',
  ] as const;
  const txCurrentKey =
    hasUploads || (busyUpload && !primaryInflight)
      ? 'uploading'
      : primaryInflight
        ? 'transcribing'
        : null;
  const txTimelinePhases = buildLinearPhases(
    TX_PHASES.map((k) => ({
      key: k,
      label: tProcess(`transcripts.${k}` as never),
    })),
    txCurrentKey,
  );

  // 헤더 pill 로 push 할 live state. 우선순위:
  //   1) 로컬 업로드 진행 중 → "UPLOADING NN%"
  //   2) 전사 잡 inflight (submitting/transcribing/queued) → 가장 최근
  //      잡의 ETA 추정 진행률 + 라벨
  //   3) 가장 최근 잡이 error → 'error'
  //   4) 그 외 + done 잡 있음 → 'done'
  //   5) 그 외 → 'idle'
  const { setState } = useWidgetState();
  const uploadValues = Object.values(job.localUploads);
  const uploadingAvgPct =
    uploadValues.length > 0
      ? Math.round(
          uploadValues.reduce((s, v) => s + v, 0) / uploadValues.length,
        )
      : null;
  const inflightJob = queueJobs[0] ?? null;
  const errorJob = job.jobs.find((j) => j.status === 'error') ?? null;
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
        inflightJob.status === 'queued'
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
    if (errorJob) {
      setState({
        kind: 'error',
        message: errorJob.error_message ?? undefined,
      });
      return;
    }
    if (doneJobs.length > 0) {
      setState({ kind: 'done' });
      return;
    }
    setState({ kind: 'idle' });
  }, [
    setState,
    uploadingAvgPct,
    inflightJob,
    errorJob,
    doneJobs.length,
    nowTick,
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
  const modeDesc: Record<TranscriptMode, string> = {
    research: tWidgets('transcriptModeResearchDesc'),
    meeting: tWidgets('transcriptModeMeetingDesc'),
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
      {/* 언어 + 발화자 수 — 나란히. 발화자 수는 diarization hint 로 배선. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="언어">
          <DropdownMenu
            items={languageItems}
            trigger={({ open, onClick, ...aria }) => (
              <ControlTrigger
                {...aria}
                data-open={open}
                onClick={onClick}
                aria-label="언어"
              >
                {currentLanguageLabel}
              </ControlTrigger>
            )}
          />
        </Field>

        <Field label={tWidgets('transcriptSpeakerLabel')}>
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
        </Field>
      </div>

      {/* 전사 모드 — 리서치(현행) / 회의록. ModeCardGroup(#852) single. */}
      <Field label={tWidgets('transcriptModeLabel')}>
        <ModeCardGroup
          ariaLabel={tWidgets('transcriptModeLabel')}
          options={MODE_OPTIONS.map((opt) => ({
            key: opt.key,
            icon: opt.icon,
            label: modeTitle[opt.key],
            description: modeDesc[opt.key],
          }))}
          value={mode}
          onChange={(key) => setMode(key as TranscriptMode)}
        />
      </Field>

      {/* 인라인 업로드 — 옛 📤 업로드 버튼 + 모달을 대체. 드래그드롭 + 클릭
          업로드 둘 다 primitive 가 지원. onDropRaw 로 워크스페이스 artifact
          드롭도 그대로 수용. */}
      <ControlDropzone
        accept={ACCEPT}
        multiple
        disabled={busyUpload}
        onFiles={(files) => startUploads(files)}
        onDropRaw={handleArtifactDrop}
        label={tUp('dropHere')}
        helperText={tUp('supported')}
      />

      {/* 직접 녹음 — 파일 업로드 대신 위젯에서 바로 마이크 녹음 (#503).
          정지 시 Blob→File 로 래핑해 startUploads 로 투입 → 파일 업로드와
          동일한 언어확인·업로드·전사 흐름(mode/발화자/언어)이 재사용된다. */}
      <TranscriptRecordButton
        disabled={busyUpload}
        onRecorded={(file) => startUploads([file])}
      />

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
          {txInflight ? (
              // active: 컨트롤+CTA 완전 대체 → 공정 과정 타임라인.
              <ProcessTimeline phases={txTimelinePhases} />
            ) : showDone ? (
              // done: "완료됐어요! + 전체 보기" (+ 파일 추가 업로드 경로 보존).
              <div className="flex flex-col items-center gap-6 py-8">
                <p className="text-lg font-semibold text-ink-2">
                  ✅ {tProcess('completeTitle')}
                </p>
                <ChromeButton
                  variant="default"
                  size="lg"
                  onClick={handleQuotesFullview}
                >
                  {tWidgets('viewAll')}
                </ChromeButton>
                {/* 파일 추가 업로드 경로 — 모달 제거 후 인라인 dropzone 으로.
                    드롭/클릭 → 새 전사 flow (idle 컨트롤과 동일 핸들러). */}
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
            {/* 업로드 진행 + 큐. flex-1 로 산출물을 채우고, 길어지면 자체
                스크롤. 수평 여백·클러스터(컨트롤 좌측 정합)는 WidgetOutputRegion
                SSOT 소유 — 손코딩 px 금지. */}
            <WidgetOutputRegion padY="lg">
              <div className="space-y-5">
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
                    <SectionLabel>진행 중 / 대기</SectionLabel>
                    <span className="text-xs text-mute-soft">{queueJobs.length}건</span>
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
                  이 구간에도 위젯이 진행 신호를 잃지 않도록 indeterminate 바를
                  노출 (업로드 진행 중이거나 이미 큐에 잡이 뜬 경우는 제외). */}
              {busyUpload && !hasUploads && queueJobs.length === 0 && (
                <div>
                  <SectionLabel>진행 중</SectionLabel>
                  <div className="mt-2">
                    <JobProgress label={tCommon('transcribing')} variant="inline" />
                  </div>
                </div>
              )}
              </div>
            </WidgetOutputRegion>

            {/* 상태 푸터 — 진행중(업로드/전사 시작/전사 inflight)이면 "전사가
                진행중", 완료본만 있으면 "전사가 완료되었습니다"(클릭 → fullview).
                진행중이 완료보다 우선. `busyUpload` 포함이 핵심: 업로드 100% 직후
                /api/transcripts/start 응답을 기다리는 갭(잡이 아직 job.jobs 에
                안 뜬 구간) 동안에도 running 을 유지해, 이전 완료본이 있어도
                "완료" 로 오표시하지 않는다. 시작 실패로 readyFiles 에 남은
                대기분이 있으면(pending-retry) 완료로 오인시키지 않고 푸터를
                숨긴다 — slim bar 재확장의 재시도 CTA + 에러 hint 가 신호를 담당. */}
            {(() => {
              const inflight = job.jobs.some(
                (j) =>
                  j.status === 'submitting' ||
                  j.status === 'transcribing' ||
                  j.status === 'queued',
              );
              const running = hasUploads || busyUpload || inflight;
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
              // pending-retry 중엔 완료로 오인시키지 않는다.
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
          title="전사록 — 전체 보기"
          subtitle={`완료 ${doneJobs.length}건 · 진행 중 ${queueJobs.length}건`}
          onClose={closeFullview}
        >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1100px] flex-col px-6 py-6">
          <div className="mb-4 shrink-0">
            <Input
              fullWidth
              value={fullviewQuery}
              onChange={(e) => setFullviewQuery(e.target.value)}
              placeholder="파일명으로 검색…"
              aria-label="전사록 파일명 검색"
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
                    {q ? '검색 결과가 없습니다.' : '아직 전사 작업이 없습니다.'}
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
                      aria-label="전체 선택"
                    />
                    전체 선택
                  </label>
                </div>

                {/* Bulk toolbar — 선택 1개 이상일 때만 노출. 목록 스크롤 영역
                    밖(shrink-0)이라 스크롤해도 항상 보인다. 다운로드는 confirm
                    없이 바로, 삭제는 confirm 모달(결정 3). */}
                {selected.size > 0 && (
                  <div className="mb-3 flex shrink-0 items-center gap-3 border-2 border-line-soft bg-amore-bg px-4 py-2 rounded-sm">
                    <span className="text-sm font-semibold text-ink-2">
                      {selected.size}개 선택
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={clearSelection}
                      >
                        선택 해제
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => bulkDownload(selectedList)}
                      >
                        📥 ZIP 다운로드 ({selected.size})
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setBulkDeleteOpen(true)}
                        disabled={bulkBusy}
                      >
                        🗑 일괄 삭제 ({selected.size})
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
        title="선택한 전사 작업 삭제"
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-md leading-[1.7] text-mute">
            선택한 <span className="font-semibold text-ink-2">{selected.size}개</span>{' '}
            전사 작업을 삭제할까요? 되돌릴 수 없습니다.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkBusy}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="md"
              onClick={() => void bulkDelete(Array.from(selected))}
              disabled={bulkBusy}
            >
              {bulkBusy ? '삭제 중…' : `${selected.size}개 삭제`}
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
            <select
              id="transcript-language-confirm"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              autoFocus
              className="w-full border border-line bg-paper px-3 py-2 text-lg text-ink-2 rounded-sm focus:border-ink focus:outline-none"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label} ({l.code})
                </option>
              ))}
            </select>
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
  previewMode = 'modal',
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  job: TranscriptJob;
  onDelete: () => void;
  // 'modal' = 카드 안 (default) — 미리보기 클릭 시 Modal 팝업.
  // 'inline' = "더보기" 모달 안 — 기존 expand 동작 유지 (nested modal 회피).
  previewMode?: 'modal' | 'inline';
  // fullview 일괄 선택용. selectable=false (default) 면 체크박스 미노출 —
  // 카드 안 큐/산출물 목록은 기존 그대로.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (on: boolean) => void;
}) {
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
  const pill = pillFor(job.status);
  const inFlight = job.status === 'submitting' || job.status === 'transcribing';
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
            aria-label={`${job.filename} 선택`}
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
                    title: job.filename || '전사록',
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
                {previewMode === 'inline' && previewOpen ? '접기' : '미리보기'}
              </Button>
            </div>
          )}
          <IconButton
            variant="ghost-danger"
            aria-label="전사 작업 삭제"
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
              정제본
            </Button>
            <Button
              variant={source === 'raw' ? 'primary' : 'ghost'}
              size="xs"
              onClick={() => setSource('raw')}
              className="uppercase tracking-[0.18em]"
            >
              원본
            </Button>
          </div>
          {typeof touched === 'number' && typeof total === 'number' && (
            <div className="text-xs-soft text-mute-soft tabular-nums">
              보정 {touched}/{total} turn
            </div>
          )}
        </div>
      )}
      {error ? (
        <div className="text-sm text-warning">{error}</div>
      ) : html === null ? (
        <div className="text-sm text-mute-soft">불러오는 중…</div>
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

function pillFor(status: TranscriptJobStatus): { text: string; cls: string } {
  switch (status) {
    case 'queued':
      return { text: '대기', cls: 'text-mute-soft' };
    case 'submitting':
      return { text: '제출 중', cls: 'text-amore' };
    case 'transcribing':
      return { text: '전사 중', cls: 'text-amore' };
    case 'done':
      return { text: '완료', cls: 'text-amore' };
    case 'error':
      return { text: '오류', cls: 'text-warning' };
  }
}
