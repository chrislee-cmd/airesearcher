'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { parsePartialJson } from 'ai';
import * as XLSX from 'xlsx';
import { useRouter } from '@/i18n/navigation';
import { useRequireAuth } from './auth-provider';
import { track } from './mixpanel-provider';

const MAX_BYTES = 25 * 1024 * 1024;

export type ConvStatus = 'queued' | 'converting' | 'done' | 'error';
export type ExtractStatus = 'idle' | 'extracting' | 'done' | 'error';

export type ExtractItem = {
  question: string;
  voc: string;
};

export type ConvItem = {
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

export type AnalysisRow = {
  question: string;
  cells: { filename: string; voc: string }[];
};

export type AnalysisResult = {
  questions: string[];
  rows: AnalysisRow[];
};

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
        voc: typeof c.voc === 'string' ? c.voc : '',
      }));
    rows.push({ question, cells });
  }
  const questions = Array.isArray(o.questions)
    ? (o.questions.filter((q) => typeof q === 'string') as string[])
    : rows.map((r) => r.question);
  return { questions, rows };
}

export type ThinkingEvent =
  | { id: string; type: 'reading'; filename: string; chars: number; ts: number }
  | { id: string; type: 'snippet'; filename: string; text: string; ts: number }
  | {
      id: string;
      type: 'item';
      filename: string;
      question: string;
      voc: string;
      ts: number;
    }
  | {
      id: string;
      type: 'complete';
      filename: string;
      total: number;
      invalid: number;
      ts: number;
    }
  | { id: string; type: 'aggregate_start'; ts: number }
  | { id: string; type: 'aggregate_done'; rows: number; ts: number };

type Ctx = {
  items: ConvItem[];
  filenameOrder: string[];
  queuedCount: number;
  doneCount: number;
  convertingAll: boolean;
  analyzing: boolean;
  analysis: AnalysisResult | null;
  analyzeError: string | null;
  isWorking: boolean;
  thinkingLog: ThinkingEvent[];
  clearThinking: () => void;
  addFiles: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  toggleExpand: (id: string) => void;
  startConvertAll: () => void;
  startAnalyze: () => void;
  stopAnalyze: () => void;
  exportCsv: () => void;
  exportXlsx: () => void;
};

function buildMatrix(
  result: AnalysisResult,
  filenameOrder: string[],
): string[][] {
  const header = ['문항', ...filenameOrder];
  const rows = result.rows.map((row) => {
    const cellsByFile = new Map(row.cells.map((c) => [c.filename, c]));
    return [
      row.question,
      ...filenameOrder.map((f) => cellsByFile.get(f)?.voc ?? ''),
    ];
  });
  return [header, ...rows];
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeCsvBlob(matrix: string[][]) {
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
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
}

function makeXlsxBlob(matrix: string[][]) {
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Analysis');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const InterviewJobContext = createContext<Ctx | null>(null);

export function useInterviewJob() {
  const v = useContext(InterviewJobContext);
  if (!v) {
    throw new Error('useInterviewJob must be used inside <InterviewJobProvider>');
  }
  return v;
}

export function InterviewJobProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const requireAuth = useRequireAuth();

  const [items, setItems] = useState<ConvItem[]>([]);
  const [convertingAll, setConvertingAll] = useState(false);
  const [thinkingLog, setThinkingLog] = useState<ThinkingEvent[]>([]);
  // Captured at submit() time so the useObject onFinish callback (which
  // runs in a stale closure scope) still knows which files to label.
  const currentFilenamesRef = useRef<string[]>([]);
  // Mirror of `items` for code paths that run inside async closures
  // (extractOne / runAnalyzePipeline) where the state captured at call
  // time would otherwise be stale and miss freshly-converted files.
  const itemsRef = useRef<ConvItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  type DistributiveOmit<T, K extends keyof T> = T extends T
    ? Omit<T, K>
    : never;
  type ThinkingEventInput = DistributiveOmit<ThinkingEvent, 'id' | 'ts'>;

  const pushThinking = useCallback((evt: ThinkingEventInput) => {
    setThinkingLog((prev) =>
      [
        ...prev,
        {
          ...evt,
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          ts: Date.now(),
        } as ThinkingEvent,
      ].slice(-300),
    );
  }, []);

  const clearThinking = useCallback(() => setThinkingLog([]), []);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  async function submit(payload: {
    extractions: { filename: string; items: ExtractItem[] }[];
  }) {
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalysis(null);
    const ac = new AbortController();
    analyzeAbortRef.current = ac;
    try {
      const res = await fetch('/api/interviews/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      const json = await res.json();
      if (!res.ok) {
        setAnalyzeError(json.error ?? 'analyze_failed');
        return;
      }
      const result = normalizePartial(json) ?? { questions: [], rows: [] };
      setAnalysis(result);
      pushThinking({ type: 'aggregate_done', rows: result.rows.length });
      router.refresh();
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setAnalyzeError(e instanceof Error ? e.message : 'network_error');
      }
    } finally {
      setAnalyzing(false);
      analyzeAbortRef.current = null;
    }
  }
  function stopAnalyze() {
    analyzeAbortRef.current?.abort();
  }

  const queuedCount = items.filter((i) => i.status === 'queued').length;
  const doneCount = items.filter((i) => i.status === 'done').length;

  const filenameOrder = useMemo(
    () =>
      items
        .filter((i) => i.status === 'done' && i.markdown)
        .map((i) => i.file.name),
    [items],
  );

  const isWorking = convertingAll || analyzing || items.some(
    (i) => i.extractStatus === 'extracting',
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

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, expanded: !i.expanded } : i)),
    );
  }, []);

  // Reads `items` lazily inside async — closures may be stale, but we look
  // up by id so the lookup still resolves the right ConvItem regardless.
  async function convertOne(id: string, snapshot: ConvItem[]) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: 'converting', error: undefined } : i,
      ),
    );
    const target = snapshot.find((i) => i.id === id);
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

  async function extractOne(
    id: string,
    snapshot: ConvItem[],
  ): Promise<ExtractItem[] | null> {
    const target = snapshot.find((i) => i.id === id);
    if (!target?.markdown) return null;

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, extractStatus: 'extracting', extractError: undefined }
          : i,
      ),
    );

    pushThinking({
      type: 'reading',
      filename: target.file.name,
      chars: target.markdown.length,
    });
    // Surface a real snippet from the file so the user can see *what*
    // the model is reading, not just an abstract status.
    const snippet = target.markdown.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (snippet) {
      pushThinking({ type: 'snippet', filename: target.file.name, text: snippet });
    }

    let liveItems: ExtractItem[] = [];

    try {
      const res = await fetch('/api/interviews/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: target.file.name,
          markdown: target.markdown,
        }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error ?? res.statusText ?? 'extract_failed';
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, extractStatus: 'error', extractError: msg } : i,
          ),
        );
        return null;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let emitted = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parsed = await parsePartialJson(buffer);
        if (!parsed.value || typeof parsed.value !== 'object') continue;
        const itemsField = (parsed.value as { items?: unknown }).items;
        if (!Array.isArray(itemsField)) continue;

        const complete: ExtractItem[] = [];
        for (const it of itemsField) {
          if (!it || typeof it !== 'object') continue;
          const ii = it as Record<string, unknown>;
          if (
            typeof ii.question === 'string' &&
            typeof ii.voc === 'string'
          ) {
            complete.push({
              question: ii.question,
              voc: ii.voc,
            });
          }
        }
        liveItems = complete;
        while (emitted < complete.length) {
          const it = complete[emitted];
          pushThinking({
            type: 'item',
            filename: target.file.name,
            question: it.question,
            voc: it.voc,
          });
          emitted += 1;
        }
        // Mid-stream UI: progressively expose how many items are in so far.
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, extractTotal: complete.length } : i,
          ),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, extractStatus: 'error', extractError: msg } : i,
        ),
      );
      return null;
    }

    // Verify each VOC quote is actually present in the source markdown
    // (whitespace-normalised substring match). VOCs can now be sentence- to
    // paragraph-length, so collapse whitespace before comparing.
    const normSrc = target.markdown.replace(/\s+/g, ' ').trim();
    let invalid = 0;
    const verified: ExtractItem[] = liveItems.map((it) => {
      const v = (it.voc ?? '').trim();
      if (!v) return { ...it, voc: '' };
      const normV = v.replace(/\s+/g, ' ').trim();
      if (normSrc.includes(normV)) return it;
      invalid += 1;
      return { ...it, voc: '' };
    });

    pushThinking({
      type: 'complete',
      filename: target.file.name,
      total: liveItems.length,
      invalid,
    });

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              extractStatus: 'done',
              extractItems: verified,
              extractInvalid: invalid,
              extractTotal: liveItems.length,
            }
          : i,
      ),
    );
    return verified;
  }

  function startConvertAll() {
    requireAuth(() => {
      void runConvertAll();
    });
  }

  async function runConvertAll() {
    if (convertingAll) return;
    setConvertingAll(true);
    const initial = itemsRef.current;
    const queue = initial
      .filter((i) => i.status === 'queued')
      .map((i) => i.id);
    for (const id of queue) {
      // Pass the *current* items each iteration so convertOne always
      // sees the latest File reference (in case anyone removed/added).
      await convertOne(id, itemsRef.current);
    }
    setConvertingAll(false);
    router.refresh();
    // Auto-chain into Pass A → Pass B once conversion finishes.
    const ready = itemsRef.current.filter(
      (i) => i.status === 'done' && i.markdown,
    );
    if (ready.length === 0) return;
    track('interview_analyze_start', { fileCount: ready.length });
    setThinkingLog([]);
    void runAnalyzePipeline();
  }

  function startAnalyze() {
    requireAuth(() => {
      track('interview_analyze_start', { fileCount: filenameOrder.length });
      setThinkingLog([]);
      void runAnalyzePipeline();
    });
  }

  async function runAnalyzePipeline() {
    const ready = itemsRef.current.filter(
      (i) => i.status === 'done' && i.markdown,
    );
    if (ready.length === 0) return;

    const extractions: { filename: string; items: ExtractItem[] }[] = [];
    for (const file of ready) {
      const extracted = await extractOne(file.id, itemsRef.current);
      if (extracted) {
        extractions.push({ filename: file.file.name, items: extracted });
      }
    }
    if (extractions.length === 0) return;

    pushThinking({ type: 'aggregate_start' });
    currentFilenamesRef.current = extractions.map((e) => e.filename);
    submit({ extractions });
  }

  function exportCsv() {
    if (!analysis || !filenameOrder.length) return;
    triggerDownload(
      makeCsvBlob(buildMatrix(analysis, filenameOrder)),
      'interview-analysis.csv',
    );
  }
  function exportXlsx() {
    if (!analysis || !filenameOrder.length) return;
    triggerDownload(
      makeXlsxBlob(buildMatrix(analysis, filenameOrder)),
      'interview-analysis.xlsx',
    );
  }

  const value: Ctx = {
    items,
    filenameOrder,
    queuedCount,
    doneCount,
    convertingAll,
    analyzing,
    analysis,
    analyzeError,
    isWorking,
    thinkingLog,
    clearThinking,
    addFiles,
    remove,
    clear,
    toggleExpand,
    startConvertAll,
    startAnalyze,
    stopAnalyze,
    exportCsv,
    exportXlsx,
  };

  return (
    <InterviewJobContext.Provider value={value}>
      {children}
    </InterviewJobContext.Provider>
  );
}
