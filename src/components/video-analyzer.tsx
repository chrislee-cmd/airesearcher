'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRequireAuth } from './auth-provider';
import { useVideoJobs, type VideoJob, type VideoJobStatus } from './video-job-provider';
import { FileDropZone } from './ui/file-drop-zone';
import { JobProgress } from './ui/job-progress';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { ChromeButton } from './ui/chrome-button';
import { Textarea } from './ui/textarea';
import { DEFAULT_ANALYSIS_PROMPT } from '@/lib/video-prompts';
import { computeVideoCredits } from '@/lib/video-credits';

const ACCEPT = 'video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v';
const MAX_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

function formatBytes(n: number | null) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function pillFor(status: VideoJobStatus): { text: string; cls: string } {
  switch (status) {
    case 'uploading':
      return { text: '업로드 중', cls: 'text-amore' };
    case 'indexing':
      return { text: '인덱싱 중', cls: 'text-amore' };
    case 'indexed':
      return { text: '인덱싱 완료', cls: 'text-ink-2' };
    case 'analyzing':
      return { text: '분석 중', cls: 'text-amore' };
    case 'done':
      return { text: '완료', cls: 'text-amore' };
    case 'error':
      return { text: '오류', cls: 'text-warning' };
  }
}

function statusLabel(status: VideoJobStatus): string {
  switch (status) {
    case 'uploading':
      return '영상을 업로드하고 있어요…';
    case 'indexing':
      return 'Twelvelabs가 영상을 인덱싱하고 있어요. 영상 길이에 따라 1~5분 정도 걸릴 수 있습니다.';
    case 'analyzing':
      return 'AI가 행동 패턴과 페인포인트를 분석하고 있어요…';
    case 'indexed':
    case 'done':
    case 'error':
      return '';
  }
}

function VideoMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-4 mt-2 border-b border-line pb-2 text-3xl font-bold tracking-[-0.02em] text-ink first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-3 mt-7 text-2xl font-bold tracking-[-0.015em] text-ink-2 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-4 text-lg font-semibold text-ink-2">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="my-2 text-lg leading-[1.8] text-ink-2">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-2 list-disc space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 list-decimal space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="text-ink-2">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-ink">{children}</strong>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-amore bg-amore-bg px-4 py-2 text-md italic text-ink-2">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-5 border-line-soft" />,
        code: ({ children }) => (
          <code className="border border-line bg-paper-soft px-1.5 py-0.5 font-mono text-sm text-ink-2 [border-radius:3px]">
            {children}
          </code>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

export function VideoAnalyzer() {
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const { jobs, localUploads, setUploadProgress, clearUploadProgress, refreshJobs, removeJob } =
    useVideoJobs();
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function runUpload(file: File) {
    setUploadError(null);
    const tempId = crypto.randomUUID();
    try {
      setUploadProgress(tempId, 0);

      // 1) Get signed upload URL
      const urlRes = await fetch('/api/video/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `upload-url ${urlRes.status}`);
      }
      const { upload_url, storage_key } = await urlRes.json() as {
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
            setUploadProgress(tempId, Math.round((e.loaded / e.total) * 90));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
          reject(new Error(`storage ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        };
        xhr.onerror = () => reject(new Error('upload_network_error'));
        xhr.send(file);
      });
      setUploadProgress(tempId, 95);

      // 3) Start Twelvelabs indexing + create DB job
      const startRes = await fetch('/api/video/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storage_key,
          filename: file.name,
          size_bytes: file.size,
        }),
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `start ${startRes.status}`);
      }
      setUploadProgress(tempId, 100);
      await refreshJobs();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'upload_failed');
    } finally {
      clearUploadProgress(tempId);
    }
  }

  const startUpload = useCallback(
    (files: File[]) => {
      requireAuth(() => {
        for (const file of files) void runUpload(file);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function deleteJob(id: string) {
    if (!confirm('이 분석 작업을 삭제할까요?')) return;
    const res = await fetch(`/api/video/jobs/${id}`, { method: 'DELETE' });
    if (res.ok) removeJob(id);
    await refreshJobs();
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="mb-3 text-md leading-[1.7] text-mute">
          사용자 테스트 또는 인터뷰 영상을 업로드하세요. AI가 행동 패턴·페인포인트·주요 순간을 분석합니다.
        </p>
        <FileDropZone
          accept={ACCEPT}
          maxSizeBytes={MAX_SIZE_BYTES}
          multiple
          onFiles={(files) => startUpload(files)}
          label="영상 파일을 끌어다 놓거나 클릭해서 선택하세요 (여러 개 동시 선택 가능)"
          helperText="지원: mp4 · mov · webm · avi · mkv · m4v (개당 최대 4 GB)"
          className="py-12"
        >
          {uploadError && (
            <div className="mt-3 text-sm text-warning">{uploadError}</div>
          )}
        </FileDropZone>
      </section>

      {/* Local upload progress */}
      {Object.keys(localUploads).length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {tCommon('uploading')}
          </h3>
          <ul className="mt-2 space-y-2">
            {Object.entries(localUploads).map(([id, { progress }]) => (
              <li key={id}>
                <JobProgress value={progress} label={tCommon('uploading')} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Server-side jobs */}
      {jobs.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            분석 작업
          </h3>
          <ul className="mt-2 space-y-3">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} onDelete={() => deleteJob(j.id)} onRefresh={refreshJobs} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JobRow({ job, onDelete, onRefresh }: { job: VideoJob; onDelete: () => void; onRefresh: () => Promise<void> }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_ANALYSIS_PROMPT);
  const [submitting, setSubmitting] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const pill = pillFor(job.status);
  const inFlight = job.status === 'uploading' || job.status === 'indexing' || job.status === 'analyzing';
  const hint = statusLabel(job.status);

  const showPromptEditor = job.status === 'indexed' || job.status === 'error' || job.status === 'done';
  const estimatedCredits = computeVideoCredits(job.duration_seconds);
  const durationMin = job.duration_seconds ? Math.ceil(job.duration_seconds / 60) : null;

  async function submitAnalysis() {
    if (submitting) return;
    setSubmitting(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/video/jobs/${job.id}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, locale }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `analyze ${res.status}`);
      }
      setOpen(false);
      await onRefresh();
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'analyze_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="border border-line bg-paper rounded-sm">
      <div className="flex items-start gap-4 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg text-ink-2">{job.filename}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-mute-soft tabular-nums">
            <span className={`text-xs font-semibold uppercase tracking-[0.22em] ${pill.cls}`}>
              {pill.text}
            </span>
            {job.size_bytes && <span>{formatBytes(job.size_bytes)}</span>}
            {job.error_message && (
              <span className="text-warning">{job.error_message}</span>
            )}
          </div>
          {inFlight && hint && (
            <div className="mt-2">
              <JobProgress label={pill.text} hint={hint} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {job.status === 'done' && job.analysis && (
            <Button
              variant="link"
              size="xs"
              onClick={() => setOpen((v) => !v)}
              className="uppercase tracking-[0.18em]"
            >
              {open ? '접기' : '결과 보기'}
            </Button>
          )}
          <IconButton
            variant="ghost-danger"
            onClick={onDelete}
            aria-label="영상 분석 작업 삭제"
          >
            ✕
          </IconButton>
        </div>
      </div>

      {/* Prompt editor — shown for indexed (first run) and done/error (re-analyze) */}
      {showPromptEditor && (
        <div className="border-t border-line-soft px-5 pb-4 pt-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-mute-soft">
              분석 프롬프트
            </div>
            <div className="text-sm text-mute-soft tabular-nums">
              {durationMin ? `${durationMin}분 · ` : ''}이 분석 {estimatedCredits}크레딧
            </div>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            disabled={submitting || job.status === 'analyzing'}
            className="bg-paper-soft font-mono text-sm leading-[1.7]"
          />
          {analyzeError && (
            <div className="mt-1.5 text-sm text-warning">{analyzeError}</div>
          )}
          <div className="mt-2 flex gap-2">
            <ChromeButton
              variant="default"
              size="md"
              uppercase
              onClick={submitAnalysis}
              disabled={submitting || !prompt.trim() || job.status === 'analyzing'}
            >
              {submitting
                ? '요청 중…'
                : job.status === 'done' || job.status === 'error'
                ? `다시 분석 (${estimatedCredits}크레딧)`
                : `분석 시작 (${estimatedCredits}크레딧)`}
            </ChromeButton>
          </div>
        </div>
      )}

      {/* Analysis result */}
      {open && job.status === 'done' && job.analysis && (
        <div className="border-t border-line-soft px-5 pb-5 pt-4">
          <div className="max-h-[600px] overflow-y-auto">
            <VideoMarkdown source={job.analysis} />
          </div>
          <div className="mt-4 flex gap-2">
            <ChromeButton
              variant="default"
              size="md"
              uppercase
              onClick={() => {
                const blob = new Blob([job.analysis!], { type: 'text/markdown' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${job.filename.replace(/\.[^.]+$/, '')}_analysis.md`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              MD 다운로드
            </ChromeButton>
          </div>
        </div>
      )}
    </li>
  );
}
