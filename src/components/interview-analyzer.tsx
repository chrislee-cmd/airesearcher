'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  useInterviewJob,
  type AnalysisRow,
  type ConsolidatedInsight,
  type ConvItem,
  type ConvStatus,
  type OutlierCase,
  type RowSummary,
} from './interview-job-provider';
import { ThinkingPanel } from './thinking-panel';
import { JobProgress } from './ui/job-progress';
import { useWorkspace } from './workspace-provider';
import { FileDropZone } from './ui/file-drop-zone';
import { DownloadMenu } from './ui/download-menu';
import { prefillKey } from '@/lib/workspace';

// Sanitize the artifact title and ensure exactly one .md extension —
// many artifacts already carry .md in the title, so blindly appending
// would produce "foo.md.md".
function safeFilename(title: string) {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  return cleaned.replace(/\.md$/i, '');
}

const ACCEPT =
  'audio/*,video/*,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function InterviewAnalyzer() {
  const t = useTranslations('Features.interviewsView');
  const tUp = useTranslations('Features.uploader');
  const tCommon = useTranslations('Common');

  const job = useInterviewJob();
  const workspace = useWorkspace();
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
    if (files.length > 0) job.addFiles(files);
    workspace.setDragging(null);
    return true;
  }

  // Workspace "send to" → interviews. The pipeline only accepts files,
  // so the prefilled text is wrapped as a synthetic `.md` and queued
  // through the same addFiles path as a drag-drop from the panel.
  useEffect(() => {
    try {
      const k = prefillKey('interviews');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const f = new File([raw], `workspace_${stamp}.md`, {
        type: 'text/markdown',
      });
      job.addFiles([f]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export helpers live in the provider so the auto-download chain after
  // streaming finishes can reuse them. The component just passes through.
  const exportCsv = job.exportCsv;
  const exportXlsx = job.exportXlsx;
  const exportDocx = job.exportDocx;

  return (
    <div className="space-y-10">
      {/* Stage 1 */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('stage1Title')}
        </h2>
        <p className="mt-1 text-[12px] text-mute">{t('stage1Help')}</p>
        <p className="mt-1 text-[11.5px] text-mute-soft">{t('pipelineHint')}</p>

        <FileDropZone
          data-coach="interviews:upload"
          accept={ACCEPT}
          multiple
          onFiles={(files) => job.addFiles(files)}
          onDropRaw={handleArtifactDrop}
          label={tUp('dropHere')}
          helperText={tUp('supported')}
          className="mt-4 py-10"
        />

        {job.items.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between border-b border-line-soft pb-2 text-[11.5px] text-mute">
              <span className="tabular-nums">
                {tUp('filesDone', {
                  done: job.doneCount,
                  total: job.items.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={job.clear}
                  disabled={job.convertingAll || job.analyzing}
                  className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
                >
                  {tUp('clear')}
                </button>
                <button
                  data-coach="interviews:convert"
                  onClick={job.startConvertAll}
                  disabled={job.queuedCount === 0 || job.convertingAll}
                  className="border border-ink bg-ink px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 disabled:opacity-40 [border-radius:4px]"
                >
                  {job.convertingAll ? tCommon('loading') : t('convertAll')}
                </button>
              </div>
            </div>

            <ul className="mt-3 border border-line bg-paper [border-radius:4px]">
              {job.items.map((item) => (
                <ConvRow
                  key={item.id}
                  item={item}
                  onRemove={() => job.remove(item.id)}
                  onToggle={() => job.toggleExpand(item.id)}
                  t={t}
                  tUp={tUp}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Stage 2 — runs automatically after Stage 1 conversion finishes. */}
      <section>
        {(job.analyzing || job.analyzeError) && (
          <div className="flex items-center gap-3">
            {job.analyzing && (
              <div className="flex-1">
                <JobProgress
                  label="STREAMING"
                  hint={
                    job.analysis ? `${job.analysis.rows.length} rows` : undefined
                  }
                  onCancel={() => job.stopAnalyze()}
                  cancelLabel="STOP"
                />
              </div>
            )}
            {job.analyzeError && (
              <span className="text-[11.5px] text-warning">{job.analyzeError}</span>
            )}
          </div>
        )}

        <ThinkingPanel />

        {job.analysis && job.analysis.rows.length > 0 && (
          <div className="mt-6">
            <div data-coach="interviews:export" className="mb-3 flex items-center justify-end gap-2">
              {job.summarizing && (
                <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
                  요약 생성 중
                </span>
              )}
              {job.verticallySynthesizing && (
                <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
                  전체 흐름 분석 중
                </span>
              )}
              {(job.summarizeError || job.verticalSynthError) && (
                <span className="text-[11.5px] text-warning">
                  {job.summarizeError ?? job.verticalSynthError}
                </span>
              )}
              <DownloadMenu
                tone="primary"
                align="end"
                items={[
                  { format: 'csv', kind: 'action', onSelect: () => exportCsv() },
                  { format: 'xlsx', kind: 'action', onSelect: () => exportXlsx() },
                  { format: 'docx', kind: 'action', onSelect: () => exportDocx() },
                ]}
              />
            </div>
            {job.verticalDone && job.analysis.consolidated ? (
              <FinalSummaryTable
                insights={job.analysis.consolidated}
                t={t}
              />
            ) : (
              <ResultTable
                filenames={job.filenameOrder}
                rows={job.analysis.rows}
                summarizing={job.summarizing}
                t={t}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ConvRow({
  item,
  onRemove,
  onToggle,
  t,
  tUp,
}: {
  item: ConvItem;
  onRemove: () => void;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
  tUp: ReturnType<typeof useTranslations>;
}) {
  const map: Record<ConvStatus, { text: string; cls: string }> = {
    queued: { text: tUp('queued'), cls: 'text-mute-soft' },
    converting: { text: t('convertingPhase'), cls: 'text-amore' },
    done: { text: tUp('done'), cls: 'text-amore' },
    error: { text: tUp('error'), cls: 'text-warning' },
  };
  const pill = map[item.status];

  return (
    <li className="border-t border-line-soft first:border-t-0">
      <div className="flex items-center gap-4 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-2">{item.file.name}</div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-mute-soft tabular-nums">
            <span>{formatBytes(item.file.size)}</span>
            <span
              className={`uppercase tracking-[0.22em] text-[10px] font-semibold ${pill.cls}`}
            >
              {pill.text}
            </span>
            {item.status === 'done' &&
              item.inputChars !== undefined &&
              item.outputChars !== undefined && (
                <RetentionBadge
                  input={item.inputChars}
                  output={item.outputChars}
                  path={item.formatPath}
                />
              )}
            {item.extractStatus === 'extracting' && (
              <span className="text-amore uppercase tracking-[0.22em] text-[10px] font-semibold">
                추출 중
              </span>
            )}
            {item.extractStatus === 'done' &&
              item.extractTotal !== undefined && (
                <span
                  className={
                    (item.extractInvalid ?? 0) > 0 ? 'text-warning' : 'text-amore'
                  }
                  title={
                    (item.extractInvalid ?? 0) > 0
                      ? `${item.extractInvalid}/${item.extractTotal}개 verbatim이 원문과 일치하지 않아 비워졌습니다.`
                      : '모든 verbatim이 원문에서 검증되었습니다.'
                  }
                >
                  Q {item.extractTotal} ·{' '}
                  {item.extractTotal - (item.extractInvalid ?? 0)} verbatim
                </span>
              )}
            {item.extractStatus === 'error' && item.extractError && (
              <span className="text-warning">{item.extractError}</span>
            )}
            {item.error && (
              <span className="text-warning">
                {item.error === 'fileTooLarge' ? tUp('fileTooLarge') : item.error}
              </span>
            )}
          </div>
        </div>
        {item.status === 'done' && item.markdown && (
          <button
            onClick={onToggle}
            className="text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2"
          >
            {item.expanded ? t('hideMd') : t('viewMd')}
          </button>
        )}
        <button
          onClick={onRemove}
          aria-label={tUp('remove')}
          className="text-[11px] text-mute-soft hover:text-warning"
        >
          ✕
        </button>
      </div>
      {item.status === 'done' && item.markdown && item.expanded && (
        <div className="border-t border-line-soft px-5 pb-4 pt-3">
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.7] text-ink-2">
            {item.markdown}
          </pre>
        </div>
      )}
    </li>
  );
}

function hasSummaryContent(summary: RowSummary | undefined): boolean {
  if (!summary) return false;
  if (summary.mainstream && summary.mainstream.trim().length > 0) return true;
  return summary.outliers.length > 0;
}

function OutlierItem({ outlier }: { outlier: OutlierCase }) {
  return (
    <li className="leading-[1.7]">
      <span className="text-ink-2">{outlier.description}</span>
      {outlier.filenames.length > 0 && (
        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
          {outlier.filenames.map((fn) => (
            <span
              key={fn}
              className="inline-block border border-line-soft px-1.5 py-[1px] text-[10px] tracking-[0.04em] text-mute [border-radius:4px]"
            >
              {fn}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

function RowSummaryCell({ summary }: { summary: RowSummary }) {
  const hasMainstream =
    !!summary.mainstream && summary.mainstream.trim().length > 0;
  const hasOutliers = summary.outliers.length > 0;
  return (
    <div className="space-y-3">
      {hasMainstream && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            대표 경향성
          </div>
          <div className="leading-[1.7] whitespace-pre-wrap text-ink-2">
            {summary.mainstream}
          </div>
        </div>
      )}
      {hasOutliers && (
        <div className={hasMainstream ? 'border-t border-line-soft pt-3' : ''}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
            소수 케이스
          </div>
          <ul className="space-y-1.5">
            {summary.outliers.map((o, i) => (
              <OutlierItem key={i} outlier={o} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultTable({
  filenames,
  rows,
  summarizing,
  t,
}: {
  filenames: string[];
  rows: AnalysisRow[];
  summarizing: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-x-auto border border-line bg-paper [border-radius:4px]">
      <table className="w-full min-w-[800px] text-[12.5px]">
        <thead className="border-b border-line bg-paper-soft">
          <tr>
            <th className="sticky left-0 z-10 bg-paper-soft px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('question')}
            </th>
            <th className="border-l border-line px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('summary')}
            </th>
            {filenames.map((f) => (
              <th
                key={f}
                className="border-l border-line px-4 py-3 text-left text-[10.5px] tracking-[0.05em]"
              >
                <div className="truncate font-semibold text-ink-2">{f}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const cellsByFile = new Map(row.cells.map((c) => [c.filename, c]));
            return (
              <tr key={idx} className="border-t border-line-soft align-top">
                <td className="sticky left-0 z-10 bg-paper px-4 py-3 font-medium text-ink-2">
                  {row.question}
                </td>
                <td className="border-l border-line px-4 py-3 align-top text-ink-2">
                  {hasSummaryContent(row.summary) ? (
                    <RowSummaryCell summary={row.summary!} />
                  ) : summarizing ? (
                    <span className="text-[11px] uppercase tracking-[0.22em] text-mute-soft">
                      …
                    </span>
                  ) : null}
                </td>
                {filenames.map((f) => {
                  const c = cellsByFile.get(f);
                  return (
                    <td
                      key={f}
                      className="border-l border-line px-4 py-3 align-top"
                    >
                      {c?.voc && (
                        <div className="italic text-mute">“{c.voc}”</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Final view rendered after vertical synthesis completes. Shows the
// consolidated insights — multiple original questions may have been
// fused into one row. Respondent columns are intentionally hidden;
// they live on in the XLSX sheet 2 export.
function VocList({
  items,
}: {
  items: { filename: string; voc: string }[];
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((v, i) => (
        <li
          key={i}
          className="text-[12px] italic leading-[1.65] text-mute"
        >
          “{v.voc}”
          <span className="ml-2 not-italic text-[10.5px] tracking-[0.05em] text-mute-soft">
            — {v.filename}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FinalSummaryTable({
  insights,
  t,
}: {
  insights: ConsolidatedInsight[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-hidden border border-line bg-paper [border-radius:4px]">
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-line bg-paper-soft">
          <tr>
            <th className="w-[28%] px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('question')}
            </th>
            <th className="border-l border-line px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('summary')}
            </th>
          </tr>
        </thead>
        <tbody>
          {insights.map((insight, idx) => {
            const hasMainstream =
              !!insight.mainstream && insight.mainstream.trim().length > 0;
            const hasOutliers = insight.outliers.length > 0;
            const hasMainstreamVocs = insight.mainstreamVocs.length > 0;
            const hasOutlierVocs = insight.outlierVocs.length > 0;
            return (
              <tr key={idx} className="border-t border-line-soft align-top">
                <td className="px-5 py-4 font-medium text-ink-2">
                  <div>{insight.topic}</div>
                  {insight.sourceIndices.length > 1 && (
                    <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-mute-soft">
                      {insight.sourceIndices.length}개 문항 융합
                    </div>
                  )}
                </td>
                <td className="border-l border-line px-5 py-4 align-top text-ink-2">
                  {hasMainstream && (
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
                        대표 경향성
                      </div>
                      <div className="leading-[1.8] whitespace-pre-wrap">
                        {insight.mainstream}
                      </div>
                      {hasMainstreamVocs && (
                        <div className="mt-3">
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                            대표 VOC
                          </div>
                          <VocList items={insight.mainstreamVocs} />
                        </div>
                      )}
                    </div>
                  )}
                  {hasOutliers && (
                    <div
                      className={
                        hasMainstream
                          ? 'mt-4 border-t border-line-soft pt-4'
                          : ''
                      }
                    >
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                        소수 케이스
                      </div>
                      <ul className="space-y-1.5">
                        {insight.outliers.map((o, i) => (
                          <OutlierItem key={i} outlier={o} />
                        ))}
                      </ul>
                      {hasOutlierVocs && (
                        <div className="mt-3">
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                            소수 케이스 VOC
                          </div>
                          <VocList items={insight.outlierVocs} />
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RetentionBadge({
  input,
  output,
  path,
}: {
  input: number;
  output: number;
  path?: 'regex' | 'llm';
}) {
  const ratio = input > 0 ? output / input : 1;
  const pct = (ratio * 100).toFixed(1);
  // < 30% retention almost always means the LLM hit its output-token cap
  // and truncated the document silently. Flag it explicitly so the user
  // doesn't trust the resulting matrix as a complete representation.
  const isLow = ratio < 0.3;
  const cls = isLow
    ? 'font-semibold text-warning'
    : ratio >= 0.99
    ? 'text-amore'
    : ratio >= 0.9
    ? 'text-mute'
    : 'text-warning';
  const fmt = (n: number) => n.toLocaleString();
  const baseTitle = `원문 ${fmt(input)}자 → 변환 ${fmt(output)}자${
    path ? ` · ${path === 'regex' ? '정규식' : 'LLM'} 변환` : ''
  }`;
  const title = isLow
    ? `${baseTitle}\n⚠ 보존율이 낮습니다 (${pct}%). LLM 출력 토큰 한계로 뒷부분이 잘렸을 가능성이 큽니다 — 분석 결과가 인터뷰 일부만 반영할 수 있습니다.`
    : baseTitle;
  return (
    <span className={cls} title={title}>
      {isLow && '⚠ '}
      {fmt(input)} → {fmt(output)} chars · {pct}%
    </span>
  );
}

