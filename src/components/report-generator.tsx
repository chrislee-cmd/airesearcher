'use client';

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useWorkspace } from './workspace-provider';
import { useGenerationJobs } from './generation-job-provider';

const ACCEPT = '.docx,.md,.markdown,.txt';
const ACCEPT_RE = /\.(docx|md|markdown|txt)$/i;

type ReportResult = { html: string; sources: string[] };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ReportGenerator() {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const workspace = useWorkspace();
  const jobs = useGenerationJobs();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const job = jobs.get('reports');
  const running = job.status === 'running';
  const result =
    job.status === 'done' ? (job.result as ReportResult | null) : null;
  const errorMessage =
    job.status === 'error' ? job.error ?? 'unknown_error' : null;

  // Build a one-shot blob URL on click, trigger the download, then revoke.
  // Avoids holding a long-lived object URL across renders.
  function downloadReport() {
    if (!result?.html) return;
    const url = URL.createObjectURL(
      new Blob([result.html], { type: 'text/html;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of Array.from(incoming)) {
      if (ACCEPT_RE.test(f.name)) accepted.push(f);
      else rejectedNames.push(f.name);
    }
    setFiles((prev) => {
      // Dedup by (name, size) to avoid the user double-dropping the same file.
      const seen = new Set(prev.map((p) => `${p.name}::${p.size}`));
      const next = [...prev];
      for (const f of accepted) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
    setRejected(rejectedNames);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    // Reset so the same file can be re-picked after a remove.
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    if (files.length === 0) return;
    track('generate_clicked', { feature: 'reports', file_count: files.length });
    const submitted = files;
    await jobs.start<ReportResult>('reports', {
      input: { count: submitted.length },
      run: async () => {
        const fd = new FormData();
        for (const f of submitted) fd.append('files', f);
        const res = await fetch('/api/reports/generate', {
          method: 'POST',
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? res.statusText);
        }
        track('generate_success', { feature: 'reports' });
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const title = `report_${ts}.html`;
        workspace.addArtifact({
          featureKey: 'reports',
          title,
          content: json.html,
        });
        return { html: json.html as string, sources: json.sources ?? [] };
      },
    });
  }

  const canRun = files.length > 0 && !running;

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('reports.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('reports.cost')}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('reports.description')}
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed bg-paper px-6 py-12 text-center transition-colors duration-[120ms] [border-radius:4px] ${
          dragOver
            ? 'border-amore bg-amore-bg'
            : 'border-line hover:border-ink-2'
        }`}
      >
        <div className="text-[13px] font-semibold text-ink-2">
          파일을 끌어다 놓거나 클릭해서 업로드
        </div>
        <div className="text-[11.5px] text-mute-soft">
          .docx · .md · .markdown · .txt — 최대 20개, 파일당 25MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={onPick}
          className="hidden"
        />
      </div>

      {rejected.length > 0 && (
        <div className="mt-3 text-[11.5px] text-amore">
          허용되지 않은 형식: {rejected.join(', ')}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-5 divide-y divide-line border border-line bg-paper [border-radius:4px]">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
            >
              <span className="truncate text-ink-2">{f.name}</span>
              <span className="shrink-0 tabular-nums text-mute-soft">
                {formatBytes(f.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={running}
                className="shrink-0 text-[11.5px] text-mute hover:text-amore disabled:opacity-40"
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {files.length}개 파일
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : '리포트 생성'}
        </button>
      </div>

      {errorMessage && (
        <div className="mt-6 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
          오류: {errorMessage}
        </div>
      )}

      {result && (
        <div className="mt-10">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
              결과
            </h2>
            <button
              type="button"
              onClick={downloadReport}
              className="border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-[120ms] hover:border-ink-2 [border-radius:4px]"
            >
              HTML 다운로드
            </button>
          </div>
          {result.sources.length > 0 && (
            <p className="mt-3 text-[11.5px] text-mute-soft">
              출처: {result.sources.join(', ')}
            </p>
          )}
          <iframe
            title="리포트 미리보기"
            srcDoc={result.html}
            sandbox="allow-same-origin"
            className="mt-4 h-[78vh] w-full border border-line bg-paper [border-radius:4px]"
          />
        </div>
      )}
    </div>
  );
}
