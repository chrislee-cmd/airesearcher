'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { useRouter } from '@/i18n/navigation';
import { useRequireAuth } from './auth-provider';
import { track } from './mixpanel-provider';
import { interviewMatrixSchema } from '@/lib/interview-schema';
import * as XLSX from 'xlsx';

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT =
  'audio/*,video/*,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type ConvStatus = 'queued' | 'converting' | 'done' | 'error';

type ExtractStatus = 'idle' | 'extracting' | 'done' | 'error';

type ExtractItem = {
  question: string;
  summary: string;
  verbatim: string;
};

type ConvItem = {
  id: string;
  file: File;
  status: ConvStatus;
  markdown?: string;
  error?: string;
  expanded?: boolean;
  inputChars?: number;
  outputChars?: number;
  formatPath?: 'regex' | 'llm';
  extractStatus?: ExtractStatus;
  extractItems?: ExtractItem[];
  extractInvalid?: number;
  extractTotal?: number;
  extractError?: string;
};

type AnalysisRow = {
  question: string;
  cells: { filename: string; summary: string; voc: string }[];
};

type AnalysisResult = {
  questions: string[];
  rows: AnalysisRow[];
};

// Drop incomplete cells from a partial streamed object so we don't crash
// when the model is mid-string. Defensive — useObject already gives us
// DeepPartial<T>, which means string fields can be undefined.
function normalizePartial(obj: unknown): AnalysisResult | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const rawRows = Array.isArray(o.rows) ? o.rows : [];
  const rows: AnalysisRow[] = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') continue;
    const rr = r as Record<string, unknown>;
    const question = typeof rr.question === 'string' ? rr.question : '';
    if (!question) continue;
    const rawCells = Array.isArray(rr.cells) ? rr.cells : [];
    const cells = rawCells
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        filename: typeof c.filename === 'string' ? c.filename : '',
        summary: typeof c.summary === 'string' ? c.summary : '',
        voc: typeof c.voc === 'string' ? c.voc : '',
      }));
    rows.push({ question, cells });
  }
  const questions = Array.isArray(o.questions)
    ? (o.questions.filter((q) => typeof q === 'string') as string[])
    : rows.map((r) => r.question);
  return { questions, rows };
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function InterviewAnalyzer() {
  const t = useTranslations('Features.interviewsView');
  const tUp = useTranslations('Features.uploader');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const [items, setItems] = useState<ConvItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [convertingAll, setConvertingAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    object,
    submit,
    isLoading: analyzing,
    error: analyzeStreamError,
    stop: stopAnalyze,
  } = useObject({
    api: '/api/interviews/analyze',
    schema: interviewMatrixSchema,
    onFinish: () => router.refresh(),
  });

  const analysis = useMemo<AnalysisResult | null>(
    () => normalizePartial(object ?? null),
    [object],
  );
  const analyzeError = analyzeStreamError ? analyzeStreamError.message : null;

  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const allFiles = items.map((i) => i.file.name);

  const filenameOrder = useMemo(
    () =>
      items
        .filter((i) => i.status === 'done' && i.markdown)
        .map((i) => i.file.name),
    [items],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const next: ConvItem[] = arr.map((file) => {
      const oversize = file.size > MAX_BYTES;
      return {
        id:
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`) as string,
        file,
        status: oversize ? 'error' : 'queued',
        error: oversize ? 'fileTooLarge' : undefined,
      };
    });
    setItems((prev) => [...prev, ...next]);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clear() {
    setItems([]);
  }

  function toggleExpand(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, expanded: !i.expanded } : i)),
    );
  }

  async function convertOne(id: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: 'converting', error: undefined } : i,
      ),
    );
    const target = items.find((i) => i.id === id);
    if (!target) return;
    track('interview_convert_start', {
      type: target.file.type,
      size: target.file.size,
    });

    const fd = new FormData();
    fd.append('file', target.file);

    try {
      const res = await fetch('/api/interviews/convert', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, status: 'error', error: json.error ?? res.statusText }
              : i,
          ),
        );
      } else {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: 'done',
                  markdown: json.markdown,
                  inputChars: json.input_chars,
                  outputChars: json.output_chars,
                  formatPath: json.format_path,
                }
              : i,
          ),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: 'error', error: msg } : i,
        ),
      );
    }
  }

  function startConvertAll() {
    requireAuth(() => {
      void runConvertAll();
    });
  }

  async function runConvertAll() {
    if (convertingAll) return;
    setConvertingAll(true);
    const queue = items.filter((i) => i.status === 'queued').map((i) => i.id);
    for (const id of queue) {
      await convertOne(id);
    }
    setConvertingAll(false);
    router.refresh();
  }

  function startAnalyze() {
    requireAuth(() => {
      track('interview_analyze_start', { fileCount: filenameOrder.length });
      void runAnalyzePipeline();
    });
  }

  async function extractOne(id: string): Promise<ExtractItem[] | null> {
    const target = items.find((i) => i.id === id);
    if (!target?.markdown) return null;
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, extractStatus: 'extracting', extractError: undefined }
          : i,
      ),
    );
    try {
      const res = await fetch('/api/interviews/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: target.file.name,
          markdown: target.markdown,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  extractStatus: 'error',
                  extractError: json.error ?? res.statusText,
                }
              : i,
          ),
        );
        return null;
      }
      const next: ExtractItem[] = json.items ?? [];
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                extractStatus: 'done',
                extractItems: next,
                extractInvalid: json.verbatim_invalid,
                extractTotal: json.verbatim_total,
              }
            : i,
        ),
      );
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, extractStatus: 'error', extractError: msg } : i,
        ),
      );
      return null;
    }
  }

  async function runAnalyzePipeline() {
    const ready = items.filter((i) => i.status === 'done' && i.markdown);
    if (ready.length === 0) return;

    // Pass A: per-file extraction (sequential — keeps things deterministic
    // and the per-file status pills update one at a time for clarity).
    const extractions: { filename: string; items: ExtractItem[] }[] = [];
    for (const file of ready) {
      const extracted = await extractOne(file.id);
      if (extracted) {
        extractions.push({ filename: file.file.name, items: extracted });
      }
    }
    if (extractions.length === 0) return;

    // Pass B: stream the cross-file matrix from the per-file extractions.
    submit({ extractions });
  }

  function buildMatrix(result: AnalysisResult): string[][] {
    const header = [t('question'), ...filenameOrder];
    const rows = result.rows.map((row) => {
      const cellsByFile = new Map(row.cells.map((c) => [c.filename, c]));
      return [
        row.question,
        ...filenameOrder.map((f) => {
          const c = cellsByFile.get(f);
          if (!c) return '';
          const parts: string[] = [];
          if (c.summary) parts.push(c.summary);
          if (c.voc) parts.push(`"${c.voc}"`);
          return parts.join('\n\n');
        }),
      ];
    });
    return [header, ...rows];
  }

  function exportCsv() {
    if (!analysis) return;
    const matrix = buildMatrix(analysis);
    const csv = matrix
      .map((row) =>
        row
          .map((cell) => {
            const needsQuote = /[",\n]/.test(cell);
            const escaped = cell.replace(/"/g, '""');
            return needsQuote ? `"${escaped}"` : escaped;
          })
          .join(','),
      )
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, 'interview-analysis.csv');
  }

  function exportXlsx() {
    if (!analysis) return;
    const matrix = buildMatrix(analysis);
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analysis');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerDownload(blob, 'interview-analysis.xlsx');
  }

  return (
    <div className="space-y-10">
      {/* Stage 1 */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
          {t('stage1Title')}
        </h2>
        <p className="mt-1 text-[12px] text-mute">{t('stage1Help')}</p>

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
              if (e.target.files?.length) addFiles(e.target.files);
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

        {items.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between border-b border-line-soft pb-2 text-[11.5px] text-mute">
              <span className="tabular-nums">
                {tUp('filesDone', { done: doneCount, total: items.length })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={clear}
                  disabled={convertingAll || analyzing}
                  className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
                >
                  {tUp('clear')}
                </button>
                <button
                  onClick={startConvertAll}
                  disabled={queuedCount === 0 || convertingAll}
                  className="border border-ink bg-ink px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 disabled:opacity-40 [border-radius:4px]"
                >
                  {convertingAll ? tCommon('loading') : t('convertAll')}
                </button>
              </div>
            </div>

            <ul className="mt-3 border border-line bg-paper [border-radius:4px]">
              {items.map((item) => (
                <ConvRow
                  key={item.id}
                  item={item}
                  onRemove={() => remove(item.id)}
                  onToggle={() => toggleExpand(item.id)}
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
          파일별로 (질문 / 요약 / verbatim) 추출 → 표준 문항으로 묶어 표 정리. VOC는 원문에 실제 존재하는 문장만 통과합니다.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={startAnalyze}
            disabled={filenameOrder.length === 0 || analyzing}
            className="border border-ink bg-ink px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
          >
            {analyzing ? t('analyzing') : t('analyze')}
          </button>
          {analyzing && (
            <>
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-amore">
                <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
                streaming
                {analysis && (
                  <span className="ml-1 tabular-nums text-mute-soft">
                    {analysis.rows.length} rows
                  </span>
                )}
              </span>
              <button
                onClick={() => stopAnalyze()}
                className="border border-line px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-mute hover:text-warning [border-radius:4px]"
              >
                stop
              </button>
            </>
          )}
          {filenameOrder.length === 0 && (
            <span className="text-[11.5px] text-mute-soft">
              {t('noConverted')}
            </span>
          )}
          {analyzeError && (
            <span className="text-[11.5px] text-warning">{analyzeError}</span>
          )}
        </div>

        {analysis && analysis.rows.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-end gap-2">
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
            <ResultTable
              filenames={filenameOrder}
              rows={analysis.rows}
              t={t}
            />
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
  t,
}: {
  filenames: string[];
  rows: AnalysisRow[];
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
                {filenames.map((f) => {
                  const c = cellsByFile.get(f);
                  return (
                    <td
                      key={f}
                      className="border-l border-line px-4 py-3 align-top"
                    >
                      {c?.summary && (
                        <div className="text-mute">{c.summary}</div>
                      )}
                      {c?.voc && (
                        <div className="mt-2 italic text-mute-soft">
                          “{c.voc}”
                        </div>
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
  // Color tiers: regex path almost always near 100%; LLM path expected ~95-100%.
  // Below 90% is the threshold for "noticeably shorter — verify."
  const cls =
    ratio >= 0.99
      ? 'text-amore'
      : ratio >= 0.9
      ? 'text-mute'
      : 'text-warning';
  const fmt = (n: number) => n.toLocaleString();
  return (
    <span
      className={cls}
      title={`원문 ${fmt(input)}자 → 변환 ${fmt(output)}자${
        path ? ` · ${path === 'regex' ? '정규식' : 'LLM'} 변환` : ''
      }`}
    >
      {fmt(input)} → {fmt(output)} chars · {pct}%
    </span>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
