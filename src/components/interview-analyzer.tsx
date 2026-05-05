'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useInterviewJob,
  type AnalysisRow,
  type ConsolidatedInsight,
  type ConvItem,
  type ConvStatus,
} from './interview-job-provider';
import { ThinkingPanel } from './thinking-panel';
import { useWorkspace } from './workspace-provider';

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
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    // Native file drop — the original path.
    if (e.dataTransfer.files?.length) {
      job.addFiles(e.dataTransfer.files);
      return;
    }
    // Workspace artifact drop — synthesize markdown File(s) from the
    // artifact content so they flow through Stage 1 like real uploads.
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
    if (files.length > 0) job.addFiles(files);
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

  // Export helpers live in the provider so the auto-download chain after
  // streaming finishes can reuse them. The component just passes through.
  const exportCsv = job.exportCsv;
  const exportXlsx = job.exportXlsx;

  return (
    <div className="space-y-10">
      {/* Stage 1 */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('stage1Title')}
        </h2>
        <p className="mt-1 text-[12px] text-mute">{t('stage1Help')}</p>
        <p className="mt-1 text-[11.5px] text-mute-soft">{t('pipelineHint')}</p>

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
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center border bg-paper py-10 text-center transition-colors duration-[120ms] [border-radius:4px] ${
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
              if (e.target.files?.length) job.addFiles(e.target.files);
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
            className="mt-4 border border-line bg-paper px-4 py-1.5 text-[11.5px] text-mute hover:text-ink-2 [border-radius:4px]"
          >
            {tUp('browse')}
          </button>
        </div>

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

      {/* Stage 2 */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('stage2Title')}
        </h2>
        <p className="mt-1 text-[12px] text-mute">{t('stage2Help')}</p>
        <p className="mt-1 text-[11.5px] text-mute-soft">
          파일별로 (질문 / VOC 인용구) 추출 → 표준 문항으로 묶어 표 정리. 셀 내용은 원문에 실제 존재하는 응답자 발화만 통과합니다.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={job.startAnalyze}
            disabled={job.filenameOrder.length === 0 || job.analyzing}
            className="border border-ink bg-ink px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
          >
            {job.analyzing ? t('analyzing') : t('analyze')}
          </button>
          {job.analyzing && (
            <>
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-amore">
                <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
                streaming
                {job.analysis && (
                  <span className="ml-1 tabular-nums text-mute-soft">
                    {job.analysis.rows.length} rows
                  </span>
                )}
              </span>
              <button
                onClick={() => job.stopAnalyze()}
                className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-warning [border-radius:4px]"
              >
                stop
              </button>
            </>
          )}
          {job.filenameOrder.length === 0 && (
            <span className="text-[11.5px] text-mute-soft">
              {t('noConverted')}
            </span>
          )}
          {job.analyzeError && (
            <span className="text-[11.5px] text-warning">{job.analyzeError}</span>
          )}
        </div>

        <ThinkingPanel />

        {job.analysis && job.analysis.rows.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-end gap-2">
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
              <button
                onClick={exportCsv}
                className="border border-line px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2 [border-radius:4px]"
              >
                {t('exportCsv')}
              </button>
              <button
                onClick={exportXlsx}
                className="border border-ink bg-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 [border-radius:4px]"
              >
                {t('exportXlsx')}
              </button>
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
                  {row.summary ? (
                    <div className="leading-[1.7] whitespace-pre-wrap">
                      {row.summary}
                    </div>
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
          {insights.map((insight, idx) => (
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
                <div className="leading-[1.8] whitespace-pre-wrap">
                  {insight.summary}
                </div>
                {insight.representativeVocs.length > 0 && (
                  <div className="mt-4 border-t border-line-soft pt-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                      대표 VOC
                    </div>
                    <ul className="space-y-1.5">
                      {insight.representativeVocs.map((v, i) => (
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
                  </div>
                )}
              </td>
            </tr>
          ))}
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

