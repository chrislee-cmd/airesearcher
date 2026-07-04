'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useRequireAuth } from '@/components/auth-provider';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import {
  useTranscriptJobs,
  type TranscriptJob,
  type TranscriptJobStatus,
} from '@/components/transcript-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { IconButton } from '@/components/ui/icon-button';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { JobProgress } from '@/components/ui/job-progress';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import {
  SectionLabel,
  WidgetOutputRow,
} from '@/components/canvas/shell/widget-outputs';
import { WidgetStatusFooter } from '@/components/canvas/shell/widget-status-footer';
import { Field } from '@/components/canvas/shell/field';
import { WidgetUploadModal } from '@/components/canvas/shell/widget-upload-modal';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { LANGUAGES, getLanguage, pickFromBrowser } from '@/lib/transcripts/languages';

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

// 스토리지 업로드 완료 후 '시작' 대기 중인 파일 메타. /api/transcripts/start
// 에 그대로 넘긴다.
type ReadyTranscriptFile = {
  storage_key: string;
  filename: string;
  mime_type?: string;
  size_bytes: number;
  language: string;
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
  const requireAuth = useRequireAuth();
  const job = useTranscriptJobs();
  const workspace = useWorkspace();

  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // 업로드 모달 open state. 옛 서브헤더 상시 dropzone 을 📤 업로드 버튼 +
  // 모달 안 dropzone 으로 이동 — 서브헤더 height ↓.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [language, setLanguage] = useState<string>('multi');
  // 통일 "전체 보기" — 전사 작업 전체를 풀스크린 list + 파일명 검색으로.
  // 공유 모달(CanvasBoard FullviewShell)이 소유하고 quotes 가 currentKey 일
  // 때만 본문을 모달 slot 으로 portal. useTranscriptJobs provider 기반이라
  // close 후 보존되고, 파일명 검색어(fullviewQuery)는 항상-마운트된 카드
  // 본문에 남아 모달 close 후에도 유지된다. 카드 바닥의 "더보기"(overflow)
  // 모달과는 의미가 다른 별도 진입 — 더보기는 그대로 유지.
  const { renderInSlot, openFullview, close: closeFullview } = useFullview('quotes');
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

  // 위젯 phase — 'idle' (실행 전, 컨트롤 보드) → 'active' (실행 중/완료,
  // slim bar + 산출물). CTA(업로드 시작) 시 active 로 승격하고 되돌아가지
  // 않는다 (결정 3 — 결과물 있으면 active 유지). `settingsExpanded` 는
  // active slim bar 의 ▼ 재확장 토글.
  const [phase, setPhase] = useState<'idle' | 'active'>('idle');
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // 실행 신호(진행/완료 잡, 로컬 업로드, 시작 대기 파일)가 하나라도 있으면
  // active 로 승격. 새로고침/다른 디바이스에서 이미 잡이 있는 경우(realtime
  // 로 늦게 로드)도 이 effect 가 idle→active 를 처리한다. active 에서 idle 로
  // 되돌리지 않는다.
  useEffect(() => {
    if (
      job.jobs.length > 0 ||
      Object.keys(job.localUploads).length > 0 ||
      readyFiles.length > 0
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- promote on external job state
      setPhase('active');
    }
  }, [job.jobs.length, job.localUploads, readyFiles.length]);

  // `startUploads` is wrapped in useCallback with empty deps, so the closure
  // around `uploadToStorage` is captured once. We mirror live state into a
  // ref so the captured uploadToStorage still reads the current language.
  const languageRef = useRef<string>(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

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
        // Close the upload modal so the language-confirm dialog shows alone
        // (both are z-modal portals — avoid stacking two modals).
        setUploadOpen(false);
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

  // Group jobs for the canvas card layout: in-flight 큐 vs 완료된 산출물.
  // pillFor 가 보는 status 5종 중 'done' 만 recents 로, 나머지는 queue 로.
  const queueJobs = job.jobs.filter((j) => j.status !== 'done');
  const doneJobs = job.jobs.filter((j) => j.status === 'done');
  const hasUploads = Object.keys(job.localUploads).length > 0;
  // 온보딩 게이팅 — 아직 아무 파일도 없음 (큐·완료·업로드·준비 전부 0). 이
  // 동안만 📤 pulse + "파일을 먼저 업로드" hint.
  const noFiles = job.jobs.length === 0 && !hasUploads && readyFiles.length === 0;
  // '시작' CTA — 업로드+언어확인까지 끝난 준비 파일이 있어야 활성.
  const readyCount = readyFiles.length;
  const canStart = readyCount > 0 && !busyUpload;

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

  // 컨트롤 보드 본체 — idle 메인 영역과 active slim bar 재확장 패널이 공유.
  // 언어 셀렉트 + 📤 업로드 CTA (+ 자동 시작 실패 시 재시도 CTA/에러 hint).
  // `idSuffix` 로 idle / expanded 인스턴스의 htmlFor 를 구분한다.
  const renderControls = (idSuffix: string) => (
    <div className="space-y-4">
      <Field label="언어" htmlFor={`transcript-lang-${idSuffix}`}>
        <Select
          id={`transcript-lang-${idSuffix}`}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          options={languageOptions}
        />
      </Field>

      {/* 📤 파일 업로드 — 클릭 시 업로드 모달(드롭존) open. 아직 파일이 없는
          첫 진입엔 amore halo pulse 로 유도. */}
      <span
        className={
          noFiles ? 'block widget-gate-guide-pulse' : 'block'
        }
      >
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => setUploadOpen(true)}
          disabled={busyUpload}
        >
          📤 {tWidgets('upload')}
        </Button>
      </span>

      {/* 자동 전사 시작이 실패해 남은 준비 파일 재시도 CTA — 정상 흐름에선
          렌더 안 됨. */}
      {readyCount > 0 && (
        <ChromeButton
          variant="primary"
          size="lg"
          onClick={() => void startTranscription()}
          disabled={!canStart}
          className="w-full"
        >
          {busyUpload
            ? tCommon('loading')
            : `${tWidgets('transcriptStart')} (${readyCount})`}
        </ChromeButton>
      )}

      {uploadError ? (
        <p className="text-sm text-warning">{uploadError}</p>
      ) : readyCount > 0 ? (
        <p className="text-xs text-mute">
          {tWidgets('transcriptReadyHint', { count: readyCount })}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      {/* 본문 — chrome 과 헤더는 widget-shell 책임. 2-phase 구조:
            · idle   → 위젯 본문 전체가 컨트롤 보드 (언어 + 📤 업로드 CTA)
            · active → 상단 slim bar (설정 요약 + ▼ 재확장) + 산출물(진행/큐)
          업로드 모달은 두 phase 공용으로 항상 마운트. */}
      <div className="flex h-full flex-col">
        {phase === 'idle' ? (
          /* ── Phase 1 (idle) — 위젯 본문 전체가 컨트롤 보드. 옛 서브헤더의
                설정/CTA 를 메인 영역으로 끌어올려 언어 설정 + 큰 📤 업로드
                CTA 만 노출. 파일 업로드 시작 시 phase='active' 로 전이. ── */
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {renderControls('idle')}
          </div>
        ) : (
          /* ── Phase 2 (active) — slim bar (설정 요약 + ▼ 재확장) + 산출물. ── */
          <>
            {/* Slim bar — 옛 서브헤더 대체. 현재 언어 요약 + 펼침 토글만. */}
            <div className="flex items-center gap-2 border-b-[2px] border-ink bg-paper-soft px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-mute">
                ⚙ 컨트롤 · {getLanguage(language).label}
              </span>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={settingsExpanded ? '컨트롤 접기' : '컨트롤 펼치기'}
                onClick={() => setSettingsExpanded((v) => !v)}
              >
                <span aria-hidden className="text-xs leading-none">
                  {settingsExpanded ? '▲' : '▼'}
                </span>
              </IconButton>
            </div>

            {/* ▼ 재확장 — 옛 컨트롤 재노출 (값 유지). 여기서 언어 변경 시
                slim bar 요약도 즉시 반영. 새 파일 업로드도 여기서 시작. */}
            {settingsExpanded && (
              <div className="border-b border-line-soft p-4">
                {renderControls('expanded')}
              </div>
            )}

            {/* 중간 영역 — 업로드 진행 + 큐. flex-1 로 산출물을 바닥으로
                밀어내고, 내용이 길어지면 자체적으로 스크롤. */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
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

        {/* 업로드 모달 — 두 phase 공용. idle 컨트롤 보드 / active slim bar
            재확장의 📤 업로드 CTA 가 연다. 파일 수신 → startUploads →
            language-confirm 다이얼로그 (모달 자동 닫힘). */}
        <WidgetUploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          title={tWidgets('upload')}
          closeLabel={tWidgets('settingsClose')}
        >
          <FileDropZone
            accept={ACCEPT}
            multiple
            disabled={busyUpload}
            onFiles={(files) => startUploads(files)}
            onDropRaw={handleArtifactDrop}
            label={tUp('dropHere')}
            helperText={tUp('supported')}
            className="w-full py-6"
          >
            {uploadError && (
              <div className="mt-3 text-sm text-warning">{uploadError}</div>
            )}
          </FileDropZone>
        </WidgetUploadModal>
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
          <div className="min-h-0 flex-1 overflow-y-auto">
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
                  <p className="py-10 text-center text-md text-mute-soft">
                    {q
                      ? '검색 결과가 없습니다.'
                      : '아직 전사 작업이 없습니다.'}
                  </p>
                );
              }
              return (
                <ul className="space-y-3">
                  {list.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      onDelete={() => deleteJob(j.id)}
                      previewMode="inline"
                    />
                  ))}
                </ul>
              );
            })()}
          </div>
        </div>
        </WidgetFullviewPanel>,
      )}
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
}: {
  job: TranscriptJob;
  onDelete: () => void;
  // 'modal' = 카드 안 (default) — 미리보기 클릭 시 Modal 팝업.
  // 'inline' = "더보기" 모달 안 — 기존 expand 동작 유지 (nested modal 회피).
  previewMode?: 'modal' | 'inline';
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
