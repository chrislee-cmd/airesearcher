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
import { LANGUAGES, pickFromBrowser } from '@/lib/transcripts/languages';
import { TRANSCRIPT_MODELS, DEFAULT_MODEL_KEY } from '@/lib/transcripts/models';

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
  const requireAuth = useRequireAuth();
  const job = useTranscriptJobs();
  const workspace = useWorkspace();

  const [dragOver, setDragOver] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('multi');
  const [modelKey, setModelKey] = useState<string>(DEFAULT_MODEL_KEY);
  const inputRef = useRef<HTMLInputElement>(null);

  // `startUploads` is wrapped in useCallback with empty deps, so the closure
  // around `runUploads` is captured once. We mirror live state into refs so
  // the captured runUploads still reads the current language/model.
  const languageRef = useRef<string>(language);
  const modelRef = useRef<string>(modelKey);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    modelRef.current = modelKey;
  }, [modelKey]);

  // Default the selector to the browser locale on mount. SSR-safe — initial
  // value is "multi" so the server and first client render agree.
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLanguage(pickFromBrowser(navigator.language));
    }
  }, []);

  const startUploads = useCallback(
    (files: File[]) => {
      requireAuth(() => {
        void runUploads(files);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

          // 3) tell the server to kick off Deepgram
          const startRes = await fetch('/api/transcripts/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              storage_key,
              filename: file.name,
              mime_type: file.type || undefined,
              size_bytes: file.size,
              language: languageRef.current,
              model: modelRef.current,
            }),
          });
          if (!startRes.ok) {
            const err = await startRes.json().catch(() => ({}));
            throw new Error(err.error ?? `start ${startRes.status}`);
          }
          track('transcript_start', {
            type: file.type,
            size: file.size,
            model: modelRef.current,
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

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      startUploads(Array.from(e.dataTransfer.files));
      return;
    }
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
    if (ids.length === 0) return;
    const lookup = new Map(workspace.artifacts.map((a) => [a.id, a] as const));
    const files: File[] = [];
    for (const id of ids) {
      const a = lookup.get(id);
      if (!a) continue;
      files.push(
        new File([a.content], `${safeFilename(a.title)}.md`, {
          type: 'text/markdown',
        }),
      );
    }
    if (files.length > 0) startUploads(files);
    workspace.setDragging(null);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  }

  async function deleteJob(id: string) {
    if (!confirm('이 전사 작업을 삭제할까요?')) return;
    const res = await fetch(`/api/transcripts/jobs/${id}`, { method: 'DELETE' });
    if (res.ok) job.removeJob(id);
    await job.refreshJobs();
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-3">
            <label
              htmlFor="transcript-model"
              className="text-[11px] uppercase tracking-[0.22em] text-mute-soft"
            >
              모델
            </label>
            <select
              id="transcript-model"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              disabled={busyUpload}
              className="border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 [border-radius:4px] disabled:opacity-40"
            >
              {TRANSCRIPT_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="transcript-language"
              className="text-[11px] uppercase tracking-[0.22em] text-mute-soft"
            >
              언어
            </label>
            <select
              id="transcript-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={busyUpload}
              className="border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 [border-radius:4px] disabled:opacity-40"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label} ({l.code})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center border bg-paper py-12 text-center transition-colors duration-[120ms] [border-radius:4px] ${
            dragOver
              ? 'border-amore bg-amore-bg'
              : 'border-dashed border-line hover:border-mute-soft'
          }`}
          style={{ borderStyle: dragOver ? 'solid' : 'dashed' }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                startUploads(Array.from(e.target.files));
              }
              e.target.value = '';
            }}
          />
          <div className="text-[13.5px] font-medium text-ink-2">
            {dragOver ? tUp('dropActive') : tUp('dropHere')}
          </div>
          <div className="mt-2 text-[11.5px] text-mute-soft">
            {tUp('supported')}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            disabled={busyUpload}
            className="mt-5 border border-line bg-paper px-4 py-1.5 text-[11.5px] text-mute transition-colors duration-[120ms] hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
          >
            {tUp('browse')}
          </button>
          {uploadError && (
            <div className="mt-3 text-[11.5px] text-warning">{uploadError}</div>
          )}
        </div>
      </section>

      {/* Active uploads (client-side progress, before the job row exists) */}
      {Object.keys(job.localUploads).length > 0 && (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            업로드 중
          </h3>
          <ul className="mt-2 space-y-2">
            {Object.entries(job.localUploads).map(([id, pct]) => (
              <li
                key={id}
                className="border border-line bg-paper px-4 py-3 [border-radius:4px]"
              >
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-mute">파일 업로드 중…</span>
                  <span className="tabular-nums text-mute-soft">{pct}%</span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden bg-line-soft [border-radius:9999px]">
                  <div
                    className="h-full bg-amore transition-[width] duration-[120ms]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Server-side jobs */}
      {job.jobs.length > 0 && (
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            전사 작업
          </h3>
          <ul className="mt-2 space-y-3">
            {job.jobs.map((j) => (
              <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JobRow({
  job,
  onDelete,
}: {
  job: TranscriptJob;
  onDelete: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const pill = pillFor(job.status);
  const inFlight = job.status === 'submitting' || job.status === 'transcribing';

  return (
    <li className="border border-line bg-paper [border-radius:4px]">
      <div className="flex items-start gap-4 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-2">{job.filename}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-mute-soft tabular-nums">
            <span
              className={`uppercase tracking-[0.22em] text-[10px] font-semibold ${pill.cls}`}
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
            <a
              href={`/api/transcripts/jobs/${job.id}/download/md`}
              className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2 [border-radius:4px]"
            >
              .md
            </a>
            <a
              href={`/api/transcripts/jobs/${job.id}/download/docx`}
              className="border border-ink bg-ink px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 [border-radius:4px]"
            >
              .docx
            </a>
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2"
            >
              {previewOpen ? '접기' : '미리보기'}
            </button>
          </div>
        )}
        <button
          onClick={onDelete}
          className="text-[11px] text-mute-soft hover:text-warning"
        >
          ✕
        </button>
      </div>
      {previewOpen && job.status === 'done' && (
        <JobPreview id={job.id} />
      )}
    </li>
  );
}

function JobPreview({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (text === null && error === null) {
    fetch(`/api/transcripts/jobs/${id}`)
      .then((r) => r.json())
      .then((j) => setText(j.markdown ?? ''))
      .catch((e) => setError(e instanceof Error ? e.message : 'fetch_failed'));
  }

  return (
    <div className="border-t border-line-soft px-5 pb-4 pt-3">
      {error ? (
        <div className="text-[11.5px] text-warning">{error}</div>
      ) : text === null ? (
        <div className="text-[11.5px] text-mute-soft">불러오는 중…</div>
      ) : (
        <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap font-mono text-[12px] leading-[1.7] text-ink-2">
          {text}
        </pre>
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
      <div className="flex items-center justify-between text-[11px] text-mute-soft tabular-nums">
        <span>
          {formatClock(elapsedSec)} 경과 · 약 {formatClock(remainSec)} 남음 (추정)
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden bg-line-soft [border-radius:9999px]">
        <div
          className="h-full bg-amore transition-[width] duration-[400ms]"
          style={{ width: `${pct}%` }}
        />
      </div>
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
