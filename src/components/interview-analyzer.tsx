'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useInterviewJob,
  MAX_FILES,
  type AnalysisRow,
  type ConsolidatedInsight,
  type ConvItem,
  type ConvStatus,
  type IndexStatus,
  type OutlierCase,
  type RowSummary,
} from './interview-job-provider';
import { ThinkingPanel } from './thinking-panel';
import { JobProgress } from './ui/job-progress';
import { useWorkspace } from './workspace-provider';
import { FileDropZone } from './ui/file-drop-zone';
import { DownloadMenu } from './ui/download-menu';
import { ShareMenu } from './ui/share-menu';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { InterviewChat } from './interview-chat';
import { prefillKey } from '@/lib/workspace';

type ResultTab = 'report' | 'chat';

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

// 업로드 영역 — FileDropZone + 변환 큐 + clear/convertAll CTAs. canvas
// widget 에서는 WidgetSubHeader 의 inputs 슬롯으로, /interviews 페이지
// 에서는 그냥 위에서 렌더. 사용자 요청으로 "1단계 — 파일을 .md로 변환"
// 타이틀 / help / pipelineHint 는 제거됨.
export function InterviewUploadArea() {
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
    // Content lives in the DB now — fetch each artifact lazily and add the
    // resulting markdown files to the job queue once all are resolved.
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
      if (files.length > 0) job.addFiles(files);
    })();
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

  return (
    <div className="w-full">
      <FileDropZone
        accept={ACCEPT}
        multiple
        disabled={job.items.length >= MAX_FILES}
        onFiles={(files) => job.addFiles(files)}
        onDropRaw={handleArtifactDrop}
        label={tUp('dropHere')}
        helperText={
          job.items.length >= MAX_FILES
            ? tUp('tooManyFiles', { max: MAX_FILES })
            : tUp('supported')
        }
        className="py-6"
      />

      {job.items.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between border-b border-line-soft pb-2 text-sm text-mute">
            <span className="tabular-nums">
              {tUp('filesDone', {
                done: job.doneCount,
                total: job.items.length,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={job.clear}
                disabled={job.convertingAll || job.analyzing}
                className="!text-sm uppercase tracking-[0.18em]"
              >
                {tUp('clear')}
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={job.startConvertAll}
                disabled={job.queuedCount === 0 || job.convertingAll}
                className="!text-sm uppercase tracking-[0.18em]"
              >
                {job.convertingAll ? tCommon('loading') : t('convertAll')}
              </Button>
            </div>
          </div>

          <ul className="mt-3 border border-line bg-paper rounded-sm">
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
    </div>
  );
}

// 분석 영역 — 변환 완료 후 자동 실행. Stage 2 (스트리밍 → 결과 표 / 채팅).
export function InterviewAnalysisArea() {
  const t = useTranslations('Features.interviewsView');

  const job = useInterviewJob();

  // Export helpers live in the provider so the auto-download chain after
  // streaming finishes can reuse them. The component just passes through.
  const exportCsv = job.exportCsv;
  const exportXlsx = job.exportXlsx;
  const exportDocx = job.exportDocx;

  // Result-area tab: default 표 형식 보고서, optional 코퍼스 채팅. Tab
  // state is scoped here (not the provider) so navigating away resets it
  // — the chat surface restores its own thread from the API on remount.
  const [resultTab, setResultTab] = useState<ResultTab>('report');

  return (
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
            <span className="text-sm text-warning">{job.analyzeError}</span>
          )}
        </div>
      )}

      <ThinkingPanel />

      {job.analysis && job.analysis.rows.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <ResultTabs
              value={resultTab}
              onChange={setResultTab}
              indexStatus={job.indexStatus}
            />
            <div className="flex items-center gap-2">
              {job.summarizing && (
                <span className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                  요약 생성 중
                </span>
              )}
              {job.verticallySynthesizing && (
                <span className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                  전체 흐름 분석 중
                </span>
              )}
              {(job.summarizeError || job.verticalSynthError) && (
                <span className="text-sm text-warning">
                  {job.summarizeError ?? job.verticalSynthError}
                </span>
              )}
              {/* Download / share belong to the table view only — the
                  chat surface has no per-message export today. */}
              {resultTab === 'report' && (
                <>
                  <DownloadMenu
                    tone="primary"
                    align="end"
                    items={[
                      { format: 'csv', kind: 'action', onSelect: () => exportCsv() },
                      { format: 'xlsx', kind: 'action', onSelect: () => exportXlsx() },
                      { format: 'docx', kind: 'action', onSelect: () => exportDocx() },
                    ]}
                  />
                  <ShareMenu
                    align="end"
                    items={[
                      {
                        destination: 'google-sheets',
                        title: '인터뷰 분석',
                        getRows: () => job.getMatrixRows(),
                      },
                    ]}
                  />
                </>
              )}
            </div>
          </div>
          {resultTab === 'report' ? (
            <>
              {job.verticalDone && job.analysis.consolidated ? (
                <FinalSummaryTable
                  insights={job.analysis.consolidated}
                  rows={job.analysis.rows}
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
              <CorpusIndexingStatus status={job.indexStatus} />
            </>
          ) : (
            <InterviewChat
              jobId={job.lastSnapshotJobId}
              indexStatus={job.indexStatus}
            />
          )}
        </div>
      )}
    </section>
  );
}

// Backward-compat composition. canvas widget body 는 두 영역을 따로
// 마운트 (WidgetSubHeader + scroll area), /interviews 페이지는 이
// composition 으로 한 번에 렌더.
export function InterviewAnalyzer() {
  return (
    <div className="space-y-10">
      <InterviewUploadArea />
      <InterviewAnalysisArea />
    </div>
  );
}

// Tab strip above the result area. The chat tab is always visible but
// disabled until the corpus is indexed — surfacing the affordance even
// in the "not ready" state is the spec's preference (lets the user
// discover the feature even on legacy jobs, where the chat panel itself
// will explain why it's inert).
function ResultTabs({
  value,
  onChange,
  indexStatus,
}: {
  value: ResultTab;
  onChange: (tab: ResultTab) => void;
  indexStatus: IndexStatus;
}) {
  // Same shape as the 양식/자동 toggle in TemplateCard above — ghost
  // buttons with !border-0 !rounded-none overrides to draw a flat tab
  // strip. Keeps the result-area look consistent across both surfaces.
  const tabCls = (active: boolean) =>
    `!border-0 !rounded-none !px-3 !py-2 !text-sm uppercase tracking-[0.22em] ${
      active
        ? '!text-ink-2 !border-b-2 !border-amore'
        : '!text-mute hover:!text-ink-2'
    }`;
  return (
    <div className="inline-flex items-center gap-1 border-b border-line-soft">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onChange('report')}
        className={tabCls(value === 'report')}
      >
        📊 표 형식 보고서
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onChange('chat')}
        className={tabCls(value === 'chat')}
        title={
          indexStatus === 'done'
            ? undefined
            : '코퍼스가 인덱싱된 후 사용할 수 있어요. (탭을 클릭하면 안내 + 인덱싱 버튼이 보입니다.)'
        }
      >
        📨 코퍼스에 질문하기
      </Button>
    </div>
  );
}

// Single-line status chip telling the user that the corpus is being
// indexed for the (forthcoming) chat surface. Hidden when there is
// nothing to indicate ('idle' = pre-snapshot; the chip would just be
// noise next to the freshly-generated report).
function CorpusIndexingStatus({ status }: { status: IndexStatus }) {
  if (status === 'idle') return null;
  const label =
    status === 'indexing'
      ? '진행 중'
      : status === 'done'
        ? '완료'
        : status === 'error'
          ? '실패'
          : '대기 중';
  const tone =
    status === 'error'
      ? 'text-warning'
      : status === 'done'
        ? 'text-mute'
        : 'text-amore';
  return (
    <div className="mt-4 flex justify-end">
      <span className={`text-xs uppercase tracking-[0.22em] ${tone}`}>
        코퍼스 인덱싱: {label}
      </span>
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
          <div className="truncate text-lg text-ink-2">{item.file.name}</div>
          <div className="mt-0.5 flex items-center gap-3 text-sm text-mute-soft tabular-nums">
            <span>{formatBytes(item.file.size)}</span>
            <span
              className={`uppercase tracking-[0.22em] text-xs font-semibold ${pill.cls}`}
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
              <span className="text-amore uppercase tracking-[0.22em] text-xs font-semibold">
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
          <Button
            variant="link"
            size="xs"
            onClick={onToggle}
            className="!text-sm uppercase tracking-[0.18em]"
          >
            {item.expanded ? t('hideMd') : t('viewMd')}
          </Button>
        )}
        <IconButton
          variant="ghost-danger"
          aria-label={tUp('remove')}
          onClick={onRemove}
          className="text-sm"
        >
          ✕
        </IconButton>
      </div>
      {item.status === 'done' && item.markdown && item.expanded && (
        <div className="border-t border-line-soft px-5 pb-4 pt-3">
          <pre className="whitespace-pre-wrap font-mono text-md leading-[1.7] text-ink-2">
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
              className="inline-block border border-line-soft px-1.5 py-[1px] text-xs tracking-[0.04em] text-mute rounded-sm"
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
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            대표 경향성
          </div>
          <div className="leading-[1.7] whitespace-pre-wrap text-ink-2">
            {summary.mainstream}
          </div>
        </div>
      )}
      {hasOutliers && (
        <div className={hasMainstream ? 'border-t border-line-soft pt-3' : ''}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
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
    <div className="overflow-x-auto border border-line bg-paper rounded-sm">
      <table className="w-full min-w-[800px] text-md">
        <thead className="border-b border-line bg-paper-soft">
          <tr>
            <th className="sticky left-0 z-10 bg-paper-soft px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('question')}
            </th>
            <th className="border-l border-line px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('summary')}
            </th>
            {filenames.map((f) => (
              <th
                key={f}
                className="border-l border-line px-4 py-3 text-left text-xs-soft tracking-[0.05em]"
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
                    <span className="text-sm uppercase tracking-[0.22em] text-mute-soft">
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
          className="text-md italic leading-[1.65] text-mute"
        >
          “{v.voc}”
          <span className="ml-2 not-italic text-xs-soft tracking-[0.05em] text-mute-soft">
            — {v.filename}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FinalSummaryTable({
  insights,
  rows,
  t,
}: {
  insights: ConsolidatedInsight[];
  rows: AnalysisRow[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-hidden border border-line bg-paper rounded-sm">
      <table className="w-full text-md">
        <thead className="border-b border-line bg-paper-soft">
          <tr>
            <th className="w-[28%] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('question')}
            </th>
            <th className="border-l border-line px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
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
                    <div className="mt-2">
                      <div className="mb-1 text-xs uppercase tracking-[0.18em] text-mute-soft">
                        융합된 문항
                      </div>
                      <ul className="space-y-0.5">
                        {insight.sourceIndices.map((si) =>
                          rows[si] ? (
                            <li
                              key={si}
                              className="text-sm leading-[1.6] text-mute"
                            >
                              {rows[si].question}
                            </li>
                          ) : null,
                        )}
                      </ul>
                    </div>
                  )}
                </td>
                <td className="border-l border-line px-5 py-4 align-top text-ink-2">
                  {hasMainstream && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-amore">
                        대표 경향성
                      </div>
                      <div className="leading-[1.8] whitespace-pre-wrap">
                        {insight.mainstream}
                      </div>
                      {hasMainstreamVocs && (
                        <div className="mt-3">
                          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
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
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                        소수 케이스
                      </div>
                      <ul className="space-y-1.5">
                        {insight.outliers.map((o, i) => (
                          <OutlierItem key={i} outlier={o} />
                        ))}
                      </ul>
                      {hasOutlierVocs && (
                        <div className="mt-3">
                          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
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

