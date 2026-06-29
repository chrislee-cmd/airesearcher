'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useRequireAuth } from '@/components/auth-provider';
import { track } from '@/components/mixpanel-provider';
import {
  useTranscriptJobs,
  type TranscriptJob,
  type TranscriptJobStatus,
} from '@/components/transcript-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { JobProgress } from '@/components/ui/job-progress';
import { Modal } from '@/components/ui/modal';
import {
  SectionLabel,
  WidgetOutputRow,
  WidgetOutputs,
} from '@/components/canvas/shell/widget-outputs';
import { Field } from '@/components/canvas/shell/field';
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
  const requireAuth = useRequireAuth();
  const job = useTranscriptJobs();
  const workspace = useWorkspace();

  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('multi');
  const [showAllRecents, setShowAllRecents] = useState(false);
  // Files held between FileDropZone receiving them and the user confirming
  // the language in the modal. Picking the wrong language is the single
  // biggest accuracy regression for transcripts (Korean audio sent to an
  // English model comes back almost unusable), so we gate every upload
  // on an explicit confirm rather than silently using whatever the
  // dropdown last had.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  // `startUploads` is wrapped in useCallback with empty deps, so the closure
  // around `runUploads` is captured once. We mirror live state into a ref so
  // the captured runUploads still reads the current language.
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
        // Don't start runUploads yet — open the language-confirm modal
        // and let the user verify. runUploads fires only after confirm.
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
      void runUploads(files);
    }
  }

  function cancelPendingUpload() {
    setPendingFiles(null);
  }

  async function runUploads(files: File[]) {
    if (busyUpload) return;
    setBusyUpload(true);
    setUploadError(null);
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

          // 3) tell the server to kick off transcription (provider is
          // language-driven: English → Deepgram nova-3, else → ElevenLabs).
          const startRes = await fetch('/api/transcripts/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              storage_key,
              filename: file.name,
              mime_type: file.type || undefined,
              size_bytes: file.size,
              language: languageRef.current,
              project_id: readActiveProjectId(),
            }),
          });
          if (!startRes.ok) {
            const err = await startRes.json().catch(() => ({}));
            throw new Error(err.error ?? `start ${startRes.status}`);
          }
          track('transcripts_upload_start', {
            type: file.type,
            size: file.size,
            language: languageRef.current,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'upload_failed';
          setUploadError(msg);
        } finally {
          job.clearUploadProgress(tempId);
        }
      }
      await job.refreshJobs();
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

  // 처리한 시간 = done 잡들의 duration_seconds 합.
  // 전사록 평균 시간 = duration_seconds 평균 (오디오 길이 평균).
  const totalDurationSec = doneJobs.reduce(
    (sum, j) => sum + (j.duration_seconds ?? 0),
    0,
  );
  const avgDurationSec = (() => {
    const durations = doneJobs
      .map((j) => j.duration_seconds ?? 0)
      .filter((d) => d > 0);
    return durations.length === 0
      ? null
      : durations.reduce((s, d) => s + d, 0) / durations.length;
  })();
  // headerProgress 도 동일 — shell 로 옮겨질 예정.

  return (
    <>
      {/* 본문 — chrome 과 헤더는 widget-shell 책임. body 는 flex column
          으로 stats (top) / 중간 영역 (flex-1) / 최근 산출물 (bottom) 3단
          으로 나뉘어 — 산출물이 카드 바닥에 고정되고 빈 공간은 중간이
          흡수. cardState / headerProgress / isRunning 은 현재 body 안에서
          는 미사용 — 후속 PR 에서 widget-shell 로 주입 검토. */}
      <div className="flex h-full flex-col">
        {/* 3 stat 타일 — 누적 메트릭 (top, fixed) */}
        <div className="grid shrink-0 grid-cols-3 divide-x divide-line-soft border-b border-line-soft">
            <StatTile label="처리한 시간" value={formatDuration(totalDurationSec) || '0m'} />
            <StatTile
              label="전사록 평균 시간"
              value={avgDurationSec ? formatDuration(avgDurationSec) : '—'}
            />
            <StatTile label="라이브러리" value={`${doneJobs.length}건`} />
          </div>

          {/* 중간 영역 — 드롭존 + 업로드 진행 + 큐. flex-1 로 산출물을
              바닥으로 밀어내고, 내용이 길어지면 자체적으로 스크롤. */}
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <FileDropZone
              accept={ACCEPT}
              multiple
              disabled={busyUpload}
              onFiles={(files) => startUploads(files)}
              onDropRaw={handleArtifactDrop}
              label={tUp('dropHere')}
              helperText={tUp('supported')}
              className="py-10"
            >
              {uploadError && (
                <div className="mt-3 text-sm text-warning">{uploadError}</div>
              )}
            </FileDropZone>

            {hasUploads && (
              <div>
                <SectionLabel>{tCommon('uploading')}</SectionLabel>
                <ul className="mt-2 space-y-2">
                  {Object.entries(job.localUploads).map(([id, pct]) => (
                    <li key={id}>
                      <JobProgress value={pct} label={tCommon('uploadingFiles')} />
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
          </div>

          {/* 최근 산출물 — 카드 바닥에 고정 (flex column 의 마지막 자식).
              primitive 가 "최근 2건만" 강제, 초과 시 더보기 모달. JobRow
              (= WidgetOutputRow) 가 단일 row 시각/액션을 책임. */}
          <WidgetOutputs
            label="최근 산출물"
            items={doneJobs}
            onMoreClick={() => setShowAllRecents(true)}
            renderItem={(j) => (
              <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
            )}
          />
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

      {/* 전체 산출물 — 카드 밖에서 풀 리스트로 열람. JobRow 그대로라
          모달 안에서도 다운로드/공유/미리보기/삭제 모두 동작. */}
      <Modal
        open={showAllRecents}
        onClose={() => setShowAllRecents(false)}
        title={`최근 산출물 (${doneJobs.length})`}
        size="lg"
      >
        <ul className="space-y-3">
          {doneJobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              onDelete={() => deleteJob(j.id)}
              previewMode="inline"
            />
          ))}
        </ul>
      </Modal>
    </>
  );
}

// stat 행의 단일 타일
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3">
      <div className="text-xs text-mute-soft">{label}</div>
      <div className="mt-0.5 text-2xl font-medium text-ink">{value}</div>
    </div>
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
