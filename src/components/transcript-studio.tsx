'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRequireAuth } from './auth-provider';
import { track } from './mixpanel-provider';
import {
  useTranscriptJobs,
  type TranscriptJob,
  type TranscriptJobStatus,
} from './transcript-job-provider';
import { useWorkspace } from './workspace-provider';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { DownloadMenu } from './ui/download-menu';
import { ShareMenu } from './ui/share-menu';
import { FileDropZone } from './ui/file-drop-zone';
import { JobProgress } from './ui/job-progress';
import { Modal } from './ui/modal';
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

export function TranscriptStudio() {
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
  const isRunning =
    hasUploads ||
    queueJobs.some((j) => j.status === 'submitting' || j.status === 'transcribing');
  const cardState = isRunning ? 'running' : queueJobs.some((j) => j.status === 'error') ? 'error' : 'idle';

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
  const headerProgress = hasUploads
    ? Math.max(...Object.values(job.localUploads), 0)
    : null;

  return (
    <>
      <div className="mx-auto w-full max-w-[860px]">
        <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper-soft shadow-bento">
          {/* Canvas card 헤더 — 라벨 + 상태 pill + 진행 바 + 비용.
              부제 제거 + 제목 크기/굵기 ↑ + 좌측 아이콘 14×14 로 시각 비중
              맞춤. running 상태 진행 바는 헤더 안에 inline 으로 유지. */}
          <div className="flex items-center gap-4 border-b border-line-soft bg-amore-bg px-5 py-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm bg-paper">
              <span className="text-2xl text-ink">◇</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl font-semibold tracking-tight text-ink-2">
                  전사록 생성기
                </span>
                <span
                  className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs ${stateBadge(cardState).cls}`}
                >
                  {stateBadge(cardState).label}
                </span>
              </div>
              {isRunning && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 w-40 overflow-hidden rounded-pill bg-line-soft">
                    <div
                      className="h-full rounded-pill bg-amore"
                      style={{ width: `${headerProgress ?? 35}%` }}
                    />
                  </div>
                  <span className="text-xs text-mute">
                    {queueJobs.length + (hasUploads ? Object.keys(job.localUploads).length : 0)}건 진행 중
                  </span>
                </div>
              )}
            </div>
            <span className="shrink-0 text-sm text-mute">25 크레딧</span>
          </div>

          {/* 3 stat 타일 — 누적 메트릭 */}
          <div className="grid grid-cols-3 divide-x divide-line-soft border-b border-line-soft">
            <StatTile label="처리한 시간" value={formatDuration(totalDurationSec) || '0m'} />
            <StatTile
              label="전사록 평균 시간"
              value={avgDurationSec ? formatDuration(avgDurationSec) : '—'}
            />
            <StatTile label="라이브러리" value={`${doneJobs.length}건`} />
          </div>

          {/* 본문 — 드롭존 + 업로드 진행 + 큐 */}
          <div className="space-y-5 px-5 py-5">
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

          {/* 최근 산출물 — 카드에는 최근 2건만, 나머지는 "더보기" 모달.
              full JobRow 로 download/share/preview/delete 모두 보존.
              더보기 버튼은 마지막 행 하단에 — 헤더에 두면 스캔 동선이
              꺾여서, 자연스러운 list-end 위치에 배치. */}
          {doneJobs.length > 0 && (
            <div className="border-t border-line-soft px-5 py-5">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>최근 산출물</SectionLabel>
                <span className="text-xs text-mute-soft">총 {doneJobs.length}건</span>
              </div>
              <ul className="space-y-3">
                {doneJobs.slice(0, 2).map((j) => (
                  <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
                ))}
              </ul>
              {doneJobs.length > 2 && (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllRecents(true)}
                    className="uppercase tracking-[0.18em]"
                  >
                    더보기 ({doneJobs.length - 2}건 더)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
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
            <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
          ))}
        </ul>
      </Modal>
    </>
  );
}

// 카드 셸의 라벨 패턴 — uppercase tracking-wider mute-soft
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-[0.22em] text-mute-soft">
      {children}
    </div>
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
function stateBadge(state: 'running' | 'idle' | 'error'): { label: string; cls: string } {
  if (state === 'running') return { label: '진행 중', cls: 'bg-amore-bg text-amore' };
  if (state === 'error') return { label: '오류', cls: 'bg-warning-bg text-warning' };
  return { label: '대기', cls: 'bg-paper text-mute' };
}

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
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

        <div className="mt-6 space-y-2">
          <label
            htmlFor="transcript-language-confirm"
            className="block text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft"
          >
            {t('languageLabel')}
          </label>
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
    </div>
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

type TranscriptSource = 'clean' | 'raw';

function JobRow({
  job,
  onDelete,
}: {
  job: TranscriptJob;
  onDelete: () => void;
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
  } | null>(null);
  const pill = pillFor(job.status);
  const inFlight = job.status === 'submitting' || job.status === 'transcribing';
  // Only thread the source query through the download URL when the user has
  // explicitly switched to raw — keeps existing share links / bookmarks valid.
  const downloadSuffix = source === 'raw' ? '?source=raw' : '';

  return (
    <li className="border border-line bg-paper rounded-sm">
      <div className="flex items-start gap-4 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg text-ink-2">{job.filename}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-mute-soft tabular-nums">
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
          </div>
          {inFlight && (
            <ProgressEstimate
              startedAt={job.created_at}
              sizeBytes={job.size_bytes}
            />
          )}
        </div>
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
              {previewOpen ? '접기' : '미리보기'}
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
      </div>
      {previewOpen && job.status === 'done' && (
        <JobPreview
          id={job.id}
          source={source}
          setSource={setSource}
          onMeta={setPreviewMeta}
          initialMeta={previewMeta}
        />
      )}
    </li>
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
  }) => void;
  initialMeta: {
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
  } | null;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the first fetch lands, we can still render the toggle if the
  // parent has cached meta from a prior open — avoids the toggle blinking out
  // when the user toggles and we're refetching.
  const [meta, setMeta] = useState<{
    hasCleanVersion: boolean;
    cleanupAudit: PreviewCleanupAudit | null;
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
        }) => {
          if (cancelled) return;
          setHtml(j.html ?? '');
          const next = {
            hasCleanVersion: !!j.hasCleanVersion,
            cleanupAudit: j.cleanupAudit ?? null,
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

  return (
    <div className="border-t border-line-soft px-5 pb-4 pt-3">
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

  // ETA heuristic: ~1.5s per MB of source file. Floor at 30s, ceiling at 30min.
  // Video files have much less audio per byte, so this overestimates a bit
  // for video — fine, better than under-promising.
  const sizeMb = sizeBytes ? sizeBytes / (1024 * 1024) : 0;
  const etaSec = Math.max(30, Math.min(30 * 60, Math.round(sizeMb * 1.5)));
  const remainSec = Math.max(0, etaSec - elapsedSec);
  const pct = Math.min(95, Math.round((elapsedSec / etaSec) * 100));

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
