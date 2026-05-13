'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useWorkspace } from './workspace-provider';
import { useGenerationJobs } from './generation-job-provider';
import { FileDropZone } from './ui/file-drop-zone';
import { JobProgress } from './ui/job-progress';
import { DownloadMenu } from './ui/download-menu';
import { triggerBlobDownload } from '@/lib/export/download';
import { prefillKey } from '@/lib/workspace';
import { FeaturePage } from './ui/feature-page';
import {
  REPORT_TYPES,
  DEFAULT_REPORT_TYPE,
  type ReportType,
} from '@/lib/reports/types';
import { EnhancePanel } from './reports/enhance-panel';
import { VersionSelector } from './reports/version-selector';
import type { ReportVersionRow } from '@/lib/reports/versions';
import type { EnhanceMode } from '@/lib/reports/context-payload';

const ACCEPT = '.docx,.md,.markdown,.txt,.csv,.xlsx,.xls';
const ACCEPT_RE = /\.(docx|md|markdown|txt|csv|xlsx|xls)$/i;

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

// Mid-stream variant of stripCodeFence + doctype wrap. The HTML stage
// streams chunks like ```html\n<!doctype html>...; without preprocessing,
// the iframe srcDoc receives the leading code fence and renders quirks-
// mode plain text (visually a blank page) until the final response when
// stripCodeFence runs. Apply the same cleanup on every chunk so the user
// watches the report build in place.
function wrapStreamingHtml(s: string): string {
  // Strip the leading fence (```html / ```markdown / ```). Trailing ```
  // is dropped at finalize time by stripCodeFence — partial chunks won't
  // have it yet so we don't try here.
  const stripped = s.replace(/^\s*```(?:html|markdown|md)?\s*/i, '');
  if (!stripped.trim()) return '';
  // If the model hasn't produced a doctype/<html> yet (it sometimes
  // streams body content first), wrap so the iframe parses it as HTML
  // rather than plain text. Mirrors the final fallback at line ~318.
  if (/<!doctype html|<html/i.test(stripped)) return stripped;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${stripped}</body></html>`;
}

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

async function persistReportSnapshot(snapshot: {
  inputs: { filename: string; size?: number; mime?: string }[];
  markdown: string;
  html: string;
}): Promise<string | null> {
  try {
    const res = await fetch('/api/reports/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...snapshot, project_id: readActiveProjectId() }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return (json.id as string | undefined) ?? null;
  } catch (err) {
    console.warn('[reports] persist snapshot failed', err);
    return null;
  }
}

export function ReportGenerator() {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const workspace = useWorkspace();
  const jobs = useGenerationJobs();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Each srcDoc update fully reloads the iframe — scroll resets to 0.
  // We watch the iframe's scroll, remember the last position, and
  // restore it after each reload. If the user is near the bottom we
  // auto-follow new content (chat-style); if they scrolled up to read,
  // we stay where they were.
  const lastScrollRef = useRef(0);
  const followBottomRef = useRef(true);

  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [reportType, setReportType] = useState<ReportType>(DEFAULT_REPORT_TYPE);
  // Live-streaming buffers — cleared at the start of each run, fed
  // chunk-by-chunk during normalize / generate so the user sees both
  // stages build progressively.
  const [streamingMd, setStreamingMd] = useState<string>('');
  const [streamingHtml, setStreamingHtml] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [tab, setTab] = useState<'html' | 'md'>('html');

  // Enhance pipeline state. reportId is the DB id of the persisted report,
  // captured after the first run completes. versions is the full tree
  // (v0 + every enhancement); selectedVersion picks which one to display.
  // While enhancing we show streaming markdown in place of the version's
  // canonical content.
  const [reportId, setReportId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ReportVersionRow[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);
  const [enhancing, setEnhancing] = useState<EnhanceMode | null>(null);
  const [enhanceStream, setEnhanceStream] = useState<string>('');

  const reloadVersions = useCallback(async (rid: string) => {
    try {
      const res = await fetch(`/api/reports/jobs/${rid}/versions`);
      if (!res.ok) return;
      const json = (await res.json()) as { versions: ReportVersionRow[] };
      setVersions(json.versions ?? []);
      const latest = (json.versions ?? []).reduce(
        (mx, v) => Math.max(mx, v.version),
        0,
      );
      setSelectedVersion(latest);
    } catch (e) {
      console.warn('[reports] load versions failed', e);
    }
  }, []);

  async function onSetHead(version: number) {
    if (!reportId) return;
    try {
      await fetch(`/api/reports/jobs/${reportId}/head`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      });
    } catch (e) {
      console.warn('[reports] set head failed', e);
    }
  }

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

  function reportStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function triggerPrint() {
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
        body: JSON.stringify({ markdown: result.markdown, reportType }),
      });
      const json = await r.json();
      if (!r.ok || !json.outline) {
        throw new Error(json.error ?? `slides_failed: ${r.statusText}`);
      }
      const { buildReportPptxBlob } = await import('@/lib/reports-pptx');
      const blob = await buildReportPptxBlob(json.outline);
      triggerBlobDownload(blob, `report_${reportStamp()}.pptx`);
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

  // Workspace "send to" → reports drops the artifact text into the file
  // list as a synthetic `.md` (the report pipeline already accepts `.md`).
  useEffect(() => {
    try {
      const k = prefillKey('reports');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const f = new File([raw], `workspace_${stamp}.md`, {
        type: 'text/markdown',
      });
      addFiles([f]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  // Result-panel buttons let the user re-run the pipeline as a different
  // direction without scrolling back up to the chooser. Reusing the
  // already-uploaded files removes a friction point at the cost of
  // another full pipeline pass (both stages re-run because each type
  // has its own normalize schema). We pass the target type explicitly
  // so we don't race the `reportType` state update.
  function onClickRegen(target: ReportType) {
    if (target === reportType || running) return;
    setReportType(target);
    requireAuth(() => void doRun(target));
  }

  async function doRun(typeOverride?: ReportType) {
    if (files.length === 0) return;
    const runType = typeOverride ?? reportType;
    track('reports_generate_click', {
      feature: 'reports',
      file_count: files.length,
      reportType: runType,
      regen: typeOverride ? true : false,
    });
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
        // Two-stage pipeline; sidebar reads the phase + percent we publish
        // here to render its busy indicator. Bumping the percent slightly
        // mid-stage keeps the bar from sitting still during long streams.
        jobs.setProgress('reports', { percent: 5, phase: 'normalizing' });
        // ─ Stage 1: normalize uploads → canonical markdown ─
        const fd = new FormData();
        for (const f of submitted) fd.append('files', f);
        fd.append('reportType', runType);
        const r1 = await fetch('/api/reports/normalize', {
          method: 'POST',
          body: fd,
        });
        if (!r1.ok) {
          const j = await r1.json().catch(() => ({}));
          throw new Error(j.error ?? `normalize_failed: ${r1.statusText}`);
        }
        jobs.setProgress('reports', { percent: 25, phase: 'normalizing' });
        const mdRaw = await consumeStream(r1, setStreamingMd);
        const markdown = stripCodeFence(mdRaw);
        if (!markdown) throw new Error('empty_markdown');
        setStreamingMd(markdown);

        // ─ Stage 2: canonical markdown → design-system HTML ─
        setStage('generate');
        setTab('html');
        jobs.setProgress('reports', { percent: 50, phase: 'generating' });
        const r2 = await fetch('/api/reports/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown, sources: sourceNames, reportType: runType }),
        });
        if (!r2.ok) {
          const j = await r2.json().catch(() => ({}));
          throw new Error(j.error ?? `generate_failed: ${r2.statusText}`);
        }
        jobs.setProgress('reports', { percent: 75, phase: 'generating' });
        const htmlRaw = await consumeStream(r2, setStreamingHtml);
        let html = stripCodeFence(htmlRaw);
        if (!/<!doctype html|<html/i.test(html)) {
          html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${html}</body></html>`;
        }

        track('reports_generate_success', { feature: 'reports', reportType: runType });
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const title = `${runType}_report_${ts}.html`;
        // Persist first so the workspace artifact can carry the DB id.
        // Without that link, picking a project from the workspace modal
        // updates only local state — the project page never sees it.
        const projectIdAtStart = readActiveProjectId();
        const dbId = await persistReportSnapshot({
          inputs: submitted.map((f) => ({
            filename: f.name,
            size: f.size,
            mime: f.type || undefined,
          })),
          markdown,
          html,
        });
        if (dbId) {
          setReportId(dbId);
          // Best-effort initial load — the v0 row is mirrored by the
          // /api/reports/jobs POST handler.
          void reloadVersions(dbId);
        }
        workspace.addArtifact({
          id: dbId ? `report_${dbId}` : undefined,
          featureKey: 'reports',
          title,
          content: html,
          dbFeature: dbId ? 'report' : undefined,
          dbId: dbId ?? undefined,
          projectId: projectIdAtStart,
        });
        return { html, markdown, sources: sourceNames };
      },
    });
    setStage(null);
  }

  const canRun = files.length > 0 && !running;
  const showResultPanel = running || result;

  const activeVersion = versions.find((v) => v.version === selectedVersion);

  // Preview priority:
  //   1. While the user is mid-enhance, show the streaming enhanced
  //      markdown — HTML tab gets a "rendering..." placeholder because
  //      the HTML is only produced server-side after the markdown stream
  //      finishes.
  //   2. Otherwise show the selected version (v1+) if loaded.
  //   3. Fall back to the live `result` from the first generation run.
  //   4. Otherwise the in-flight initial-generation stream.
  let previewHtml: string;
  let previewMd: string;
  if (enhancing) {
    previewHtml = wrapStreamingHtml('<p style="padding:24px;color:#9b9b9b">강화 결과 HTML 렌더링 대기 중...</p>');
    previewMd = enhanceStream || '(강화 시작 중)';
  } else if (activeVersion && activeVersion.version > 0) {
    previewHtml = activeVersion.html;
    previewMd = activeVersion.markdown;
  } else {
    previewHtml = result?.html ?? (wrapStreamingHtml(streamingHtml) || ' ');
    previewMd = result?.markdown ?? streamingMd;
  }

  return (
    <FeaturePage
      title={t('reports.title')}
      headerRight={t('reports.cost')}
    >
      <ReportTypeChooser
        value={reportType}
        onChange={setReportType}
        disabled={running}
      />

      <FileDropZone
        accept={ACCEPT}
        multiple
        onFiles={(files) => addFiles(files)}
        label="파일을 끌어다 놓거나 클릭해서 업로드"
        helperText=".docx · .md · .markdown · .txt · .csv · .xlsx — 최대 20개, 파일당 25MB"
        className="mt-8 gap-2 px-6 py-12"
      />

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
                {running ? (stage === 'normalize' ? '1/2' : '2/2') : '결과'}
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
              <DownloadMenu
                tone="ghost"
                align="end"
                disabled={!result || pptxBuilding}
                items={[
                  {
                    format: 'html',
                    kind: 'blob',
                    filename: `report_${reportStamp()}.html`,
                    build: () =>
                      new Blob([result?.html ?? ''], {
                        type: 'text/html;charset=utf-8',
                      }),
                  },
                  {
                    format: 'pdf',
                    kind: 'action',
                    onSelect: () => triggerPrint(),
                  },
                  {
                    format: 'pptx',
                    kind: 'action',
                    onSelect: () => downloadPptx(),
                  },
                ]}
              />
            </div>
          </div>
          {result && result.sources.length > 0 && (
            <p className="mt-3 text-[11.5px] text-mute-soft">
              출처: {result.sources.join(', ')}
            </p>
          )}
          {versions.length > 1 && (
            <div className="mt-3">
              <VersionSelector
                versions={versions}
                selectedVersion={selectedVersion}
                onSelect={setSelectedVersion}
                onSetHead={onSetHead}
                disabled={!!enhancing}
              />
            </div>
          )}
          {result && !running && (
            <RegenBar
              currentType={reportType}
              onRegen={onClickRegen}
              disabled={files.length === 0}
            />
          )}

          {running && (
            <div className="mt-4">
              <JobProgress
                value={job.progress.percent}
                label={
                  stage === 'normalize'
                    ? '표준 양식 변환 중'
                    : '리포트 작성 중'
                }
              />
            </div>
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

          {result && !running && reportId && (
            <EnhancePanel
              reportId={reportId}
              parentVersion={selectedVersion}
              busy={!!enhancing}
              onStart={(mode) => {
                setEnhancing(mode);
                setEnhanceStream('');
                setTab('md');
              }}
              onChunk={(acc) => setEnhanceStream(acc)}
              onComplete={async () => {
                setEnhancing(null);
                setEnhanceStream('');
                // The server writes the new version row in onFinish of
                // the stream, which runs after the client closes the
                // reader. Brief delay lets that settle before we refetch.
                await new Promise((r) => setTimeout(r, 600));
                if (reportId) await reloadVersions(reportId);
                setTab('html');
              }}
              onError={(msg) => {
                setEnhancing(null);
                setEnhanceStream('');
                alert(`강화 실패: ${msg}`);
              }}
            />
          )}
        </div>
      )}
    </FeaturePage>
  );
}

// Compact regenerate bar — shown under the result panel header once
// a run finishes. Lists the 3 other directions as inline buttons so the
// user can swap perspective without scrolling back to the chooser or
// re-uploading files. Each click is a fresh paid run (both stages re-fire
// because each type's normalize schema differs).
function RegenBar({
  currentType,
  onRegen,
  disabled,
}: {
  currentType: ReportType;
  onRegen: (target: ReportType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Features.reports');
  const others = REPORT_TYPES.filter((k) => k !== currentType);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
      <div className="flex items-center gap-2">
        <span className="inline-block h-px w-5 bg-amore" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
          {t('regenLabel')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {others.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onRegen(k)}
            className="border border-line bg-paper px-2.5 py-1 text-[11px] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
          >
            {t(`types.${k}.label`)}
          </button>
        ))}
      </div>
      <span className="ml-1 text-[10.5px] text-mute-soft">
        {t('regenHelp')}
      </span>
    </div>
  );
}

// Editorial 4-card chooser: amore eyebrow + label + description.
// Selected card flips to ink background (matches the primary button
// style across the app) so the active choice reads at a glance without
// breaking the single-accent rule.
function ReportTypeChooser({
  value,
  onChange,
  disabled,
}: {
  value: ReportType;
  onChange: (next: ReportType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Features.reports');
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('typeChooserLabel')}
          </span>
        </div>
        <span className="text-[11px] text-mute-soft">{t('typeChooserHelp')}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={t('typeChooserLabel')}
        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {REPORT_TYPES.map((key) => {
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(key)}
              className={`flex h-full flex-col items-start gap-1.5 border px-4 py-3 text-left transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px] ${
                selected
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-paper text-ink-2 hover:border-amore'
              }`}
            >
              <span
                className={`text-[9.5px] font-semibold uppercase tracking-[0.22em] ${
                  selected ? 'text-paper/70' : 'text-amore'
                }`}
              >
                {t(`types.${key}.label`)}
              </span>
              <span
                className={`text-[12px] leading-[1.5] ${
                  selected ? 'text-paper/90' : 'text-mute'
                }`}
              >
                {t(`types.${key}.description`)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
