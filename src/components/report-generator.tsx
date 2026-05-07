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

type Stage = 'normalize' | 'generate';

type ReportResult = {
  markdown: string;
  html: string;
  sources: string[];
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Read a fetch response as a text stream, calling onChunk with the
// running accumulator throttled to ~150ms. Returns the full final string.
async function consumeStream(
  res: Response,
  onChunk: (acc: string) => void,
): Promise<string> {
  if (!res.body) throw new Error('no_stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  let lastFlush = 0;
  let tail: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    lastFlush = Date.now();
    onChunk(acc);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      const now = Date.now();
      if (now - lastFlush >= 150) {
        if (tail) {
          clearTimeout(tail);
          tail = null;
        }
        flush();
      } else if (!tail) {
        tail = setTimeout(() => {
          tail = null;
          flush();
        }, 180);
      }
    }
  } finally {
    if (tail) clearTimeout(tail);
  }
  return acc;
}

function stripCodeFence(s: string): string {
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:html|markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return t;
}

export function ReportGenerator() {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const workspace = useWorkspace();
  const jobs = useGenerationJobs();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Each srcDoc update fully reloads the iframe — scroll resets to 0.
  // We watch the iframe's scroll, remember the last position, and
  // restore it after each reload. If the user is near the bottom we
  // auto-follow new content (chat-style); if they scrolled up to read,
  // we stay where they were.
  const lastScrollRef = useRef(0);
  const followBottomRef = useRef(true);

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  // Live-streaming buffers — cleared at the start of each run, fed
  // chunk-by-chunk during normalize / generate so the user sees both
  // stages build progressively.
  const [streamingMd, setStreamingMd] = useState<string>('');
  const [streamingHtml, setStreamingHtml] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [tab, setTab] = useState<'html' | 'md'>('html');

  const job = jobs.get('reports');
  const running = job.status === 'running';
  const result =
    job.status === 'done' ? (job.result as ReportResult | null) : null;
  const errorMessage =
    job.status === 'error' ? job.error ?? 'unknown_error' : null;

  function onIframeLoad() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const docEl = win.document.documentElement;
    if (followBottomRef.current) {
      win.scrollTo(0, docEl.scrollHeight);
    } else {
      win.scrollTo(0, lastScrollRef.current);
    }
    win.addEventListener(
      'scroll',
      () => {
        lastScrollRef.current = win.scrollY;
        const remaining = docEl.scrollHeight - (win.scrollY + win.innerHeight);
        followBottomRef.current = remaining < 40;
      },
      { passive: true },
    );
  }

  function downloadHtml() {
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

  // Trigger the browser's print dialog on the iframe content. The user
  // picks "Save as PDF" — this gives a high-fidelity PDF without dragging
  // in a heavy client-side renderer or a server Chromium.
  function downloadPdf() {
    if (!result?.html) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch (e) {
      console.error('[reports] print failed', e);
    }
  }

  const [pptxBuilding, setPptxBuilding] = useState(false);
  async function downloadPptx() {
    if (!result?.markdown || pptxBuilding) return;
    setPptxBuilding(true);
    try {
      // Stage 3: ask the model to convert the canonical markdown into a
      // typed slide outline. Then pptxgenjs renders each slide kind with
      // its own layout (kpi grid, theme split, real bar charts, etc.).
      const r = await fetch('/api/reports/slides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: result.markdown }),
      });
      const json = await r.json();
      if (!r.ok || !json.outline) {
        throw new Error(json.error ?? `slides_failed: ${r.statusText}`);
      }
      const { buildReportPptxBlob } = await import('@/lib/reports-pptx');
      const blob = await buildReportPptxBlob(json.outline);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${new Date().toISOString().slice(0, 10)}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      console.error('[reports] pptx failed', e);
      alert(`PPTX 생성 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setPptxBuilding(false);
    }
  }

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of Array.from(incoming)) {
      if (ACCEPT_RE.test(f.name)) accepted.push(f);
      else rejectedNames.push(f.name);
    }
    setFiles((prev) => {
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
    track('reports_generate_click', { feature: 'reports', file_count: files.length });
    const submitted = files;
    const sourceNames = submitted.map((f) => f.name);

    setStreamingMd('');
    setStreamingHtml('');
    setStage('normalize');
    setTab('md');
    // Fresh run — start auto-following new content again.
    lastScrollRef.current = 0;
    followBottomRef.current = true;

    await jobs.start<ReportResult>('reports', {
      input: { count: submitted.length },
      run: async () => {
        // ─ Stage 1: normalize uploads → canonical markdown ─
        const fd = new FormData();
        for (const f of submitted) fd.append('files', f);
        const r1 = await fetch('/api/reports/normalize', {
          method: 'POST',
          body: fd,
        });
        if (!r1.ok) {
          const j = await r1.json().catch(() => ({}));
          throw new Error(j.error ?? `normalize_failed: ${r1.statusText}`);
        }
        const mdRaw = await consumeStream(r1, setStreamingMd);
        const markdown = stripCodeFence(mdRaw);
        if (!markdown) throw new Error('empty_markdown');
        setStreamingMd(markdown);

        // ─ Stage 2: canonical markdown → design-system HTML ─
        setStage('generate');
        setTab('html');
        const r2 = await fetch('/api/reports/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown, sources: sourceNames }),
        });
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}));
          throw new Error(j.error ?? `generate_failed: ${r2.statusText}`);
        }
        const htmlRaw = await consumeStream(r2, setStreamingHtml);
        let html = stripCodeFence(htmlRaw);
        if (!/<!doctype html|<html/i.test(html)) {
          html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${html}</body></html>`;
        }

        track('reports_generate_success', { feature: 'reports' });
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const title = `report_${ts}.html`;
        workspace.addArtifact({
          featureKey: 'reports',
          title,
          content: html,
        });
        return { html, markdown, sources: sourceNames };
      },
    });
    setStage(null);
  }

  const canRun = files.length > 0 && !running;
  const showResultPanel = running || result;

  const previewHtml = result?.html ?? (streamingHtml || ' ');
  const previewMd = result?.markdown ?? streamingMd;

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
        data-coach="reports:upload"
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

      <div data-coach="reports:preview" className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {files.length}개 파일
        </span>
        <button
          data-coach="reports:generate"
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

      {showResultPanel && (
        <div className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {running
                  ? stage === 'normalize'
                    ? '1/2 표준 양식 변환 중…'
                    : '2/2 리포트 작성 중…'
                  : '결과'}
              </h2>
              <div className="flex items-center gap-1 text-[11.5px]">
                <button
                  type="button"
                  onClick={() => setTab('html')}
                  className={`px-2.5 py-1 transition-colors duration-[120ms] [border-radius:4px] ${
                    tab === 'html'
                      ? 'border border-ink bg-ink text-paper'
                      : 'border border-line bg-paper text-mute hover:border-ink-2'
                  }`}
                >
                  HTML 리포트
                </button>
                <button
                  type="button"
                  onClick={() => setTab('md')}
                  className={`px-2.5 py-1 transition-colors duration-[120ms] [border-radius:4px] ${
                    tab === 'md'
                      ? 'border border-ink bg-ink text-paper'
                      : 'border border-line bg-paper text-mute hover:border-ink-2'
                  }`}
                >
                  표준 양식 (.md)
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadHtml}
                disabled={!result}
                className="border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-[120ms] hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                HTML
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={!result}
                className="border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-[120ms] hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                title="브라우저 인쇄 → PDF로 저장"
              >
                PDF
              </button>
              <button
                type="button"
                onClick={downloadPptx}
                disabled={!result || pptxBuilding}
                className="border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors duration-[120ms] hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                {pptxBuilding ? 'PPTX 생성 중…' : 'PPTX'}
              </button>
            </div>
          </div>
          {result && result.sources.length > 0 && (
            <p className="mt-3 text-[11.5px] text-mute-soft">
              출처: {result.sources.join(', ')}
            </p>
          )}

          {tab === 'html' ? (
            <iframe
              ref={iframeRef}
              title="리포트 미리보기"
              srcDoc={previewHtml}
              sandbox="allow-same-origin allow-modals"
              onLoad={onIframeLoad}
              className="mt-4 h-[78vh] w-full border border-line bg-paper [border-radius:4px]"
            />
          ) : (
            <pre className="mt-4 max-h-[78vh] overflow-auto whitespace-pre-wrap border border-line bg-paper p-5 text-[12.5px] leading-[1.7] text-ink-2 [border-radius:4px]">
              {previewMd || '(아직 생성되지 않았습니다)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
