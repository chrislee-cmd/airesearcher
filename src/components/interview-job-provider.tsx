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
  // Horizontal (per-row) summary — synthesizes responses across all
  // respondents for one question. Kept on the row for sheet 2 of the
  // XLSX export.
  summary?: string;
  cells: { filename: string; voc: string }[];
};

// Consolidated insight produced by the vertical synthesis pass. One
// insight may fuse multiple AnalysisRows together (sourceIndices points
// back into AnalysisResult.rows). When present, the final view shows
// these instead of the original per-question matrix.
export type ConsolidatedInsight = {
  topic: string;
  summary: string;
  sourceIndices: number[];
  representativeVocs: { filename: string; voc: string }[];
};

export type AnalysisResult = {
  questions: string[];
  rows: AnalysisRow[];
  consolidated?: ConsolidatedInsight[];
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
  summarizing: boolean;
  summarizeError: string | null;
  verticallySynthesizing: boolean;
  verticalSynthError: string | null;
  verticalDone: boolean;
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

// Sheet 1: consolidated insights (주제, 요약). 요약 cell carries the
// summary plus a "대표 VOC" block underneath, so the spreadsheet view
// matches what the user sees in the app. Falls back to per-question
// rows if the vertical pass hasn't run yet.
function buildFinalMatrix(result: AnalysisResult): string[][] {
  const header = ['주제', '요약'];
  if (result.consolidated && result.consolidated.length > 0) {
    return [
      header,
      ...result.consolidated.map((c) => {
        const vocBlock =
          c.representativeVocs.length > 0
            ? '\n\n[대표 VOC]\n' +
              c.representativeVocs
                .map((v) => `• "${v.voc}" — ${v.filename}`)
                .join('\n')
            : '';
        return [c.topic, c.summary + vocBlock];
      }),
    ];
  }
  return [
    header,
    ...result.rows.map((row) => [row.question, row.summary ?? '']),
  ];
}

// Sheet 2: 문항 + horizontal summary + every respondent's column. By
// design vertical summary is NOT included here — sheet 2 is the
// "raw matrix" view for cross-checking against original verbatims.
function buildRespondentMatrix(
  result: AnalysisResult,
  filenameOrder: string[],
): string[][] {
  const header = ['문항', '요약', ...filenameOrder];
  const rows = result.rows.map((row) => {
    const cellsByFile = new Map(row.cells.map((c) => [c.filename, c]));
    return [
      row.question,
      row.summary ?? '',
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

function makeXlsxBlob(sheets: { name: string; matrix: string[][] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.matrix);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
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
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const summarizeAbortRef = useRef<AbortController | null>(null);
  const [verticallySynthesizing, setVerticallySynthesizing] = useState(false);
  const [verticalSynthError, setVerticalSynthError] = useState<string | null>(
    null,
  );
  const verticalSynthAbortRef = useRef<AbortController | null>(null);

  // Holistic pass: send every (question, horizontal-summary) at once so
  // the model can reason about the whole interview arc, then rewrite each
  // row's summary to reflect its position in that arc.
  async function runVerticalSynth(rowsForSynth: AnalysisRow[]) {
    // Pass per-row VOC pools so the model can pick representative quotes
    // for each consolidated insight. Empty cells are filtered out so the
    // model isn't tempted to surface "" as a quote.
    const payload = rowsForSynth
      .map((r) => ({
        question: r.question,
        summary: r.summary ?? '',
        vocs: r.cells
          .filter((c) => c.voc && c.voc.trim().length > 0)
          .map((c) => ({ filename: c.filename, voc: c.voc })),
      }))
      .filter((r) => r.question);
    if (payload.length === 0) return;
    // Build a per-row voc lookup keyed by normalized text so we can
    // verify representative VOCs against the source pool — anything
    // not found is dropped (defends against model paraphrasing).
    const vocPoolByIdx = new Map<number, Map<string, { filename: string; voc: string }>>();
    payload.forEach((r, idx) => {
      const m = new Map<string, { filename: string; voc: string }>();
      for (const v of r.vocs) {
        const key = v.voc.replace(/\s+/g, ' ').trim();
        if (key) m.set(key, v);
      }
      vocPoolByIdx.set(idx, m);
    });
    setVerticallySynthesizing(true);
    setVerticalSynthError(null);
    const ac = new AbortController();
    verticalSynthAbortRef.current = ac;
    try {
      const res = await fetch('/api/interviews/vertical-synth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        // Server returned a non-stream error (often HTML from a gateway
        // timeout). Read once as text — JSON.parse may fail.
        const raw = await res.text().catch(() => '');
        let parsed: { error?: string } = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        const fallback =
          res.status === 504
            ? 'timeout — 다시 시도해 주세요'
            : `HTTP ${res.status}`;
        setVerticalSynthError(parsed.error ?? fallback);
        return;
      }

      // Stream consolidated insights as they generate — keeps the gateway
      // proxy from 504-ing and lets the UI fill in rows progressively.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let insights: ConsolidatedInsight[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const partial = await parsePartialJson(buffer);
        if (!partial.value || typeof partial.value !== 'object') continue;
        const candidate = (partial.value as { insights?: unknown }).insights;
        if (!Array.isArray(candidate)) continue;
        const next: ConsolidatedInsight[] = [];
        for (const entry of candidate) {
          if (!entry || typeof entry !== 'object') continue;
          const e = entry as Record<string, unknown>;
          const topic = typeof e.topic === 'string' ? e.topic : '';
          const summary = typeof e.summary === 'string' ? e.summary : '';
          // Skip half-streamed entries with neither field yet — would
          // flash empty rows during the partial-JSON parse window.
          if (!topic && !summary) continue;
          const rawIdx = Array.isArray(e.sourceIndices) ? e.sourceIndices : [];
          const sourceIndices: number[] = [];
          for (const v of rawIdx) {
            if (typeof v === 'number' && Number.isInteger(v)) {
              sourceIndices.push(v);
            }
          }
          // Validate VOCs against the source rows' pools — drop any quote
          // the model paraphrased or invented. Whitespace-normalized
          // substring match: tolerates the model trimming, but rejects
          // novel phrasing.
          const allowedKeys = new Set<string>();
          const allowedByKey = new Map<string, { filename: string; voc: string }>();
          for (const idx of sourceIndices) {
            const pool = vocPoolByIdx.get(idx);
            if (!pool) continue;
            for (const [k, v] of pool) {
              allowedKeys.add(k);
              if (!allowedByKey.has(k)) allowedByKey.set(k, v);
            }
          }
          const rawVocs = Array.isArray(e.representativeVocs)
            ? e.representativeVocs
            : [];
          const representativeVocs: { filename: string; voc: string }[] = [];
          const seenKeys = new Set<string>();
          for (const rv of rawVocs) {
            if (!rv || typeof rv !== 'object') continue;
            const r = rv as Record<string, unknown>;
            const v = typeof r.voc === 'string' ? r.voc : '';
            if (!v) continue;
            const key = v.replace(/\s+/g, ' ').trim();
            if (!key || seenKeys.has(key)) continue;
            // Accept only if the normalised quote matches an allowed
            // entry (exact key) or is a substring of one.
            let matched = allowedByKey.get(key);
            if (!matched) {
              for (const ak of allowedKeys) {
                if (ak.includes(key) || key.includes(ak)) {
                  matched = allowedByKey.get(ak);
                  break;
                }
              }
            }
            if (!matched) continue;
            seenKeys.add(key);
            representativeVocs.push(matched);
          }
          next.push({ topic, summary, sourceIndices, representativeVocs });
        }
        insights = next;
        setAnalysis((prev) => {
          if (!prev) return prev;
          return { ...prev, consolidated: insights };
        });
      }
      if (insights.length === 0) {
        setVerticalSynthError('empty_response');
        return;
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setVerticalSynthError(
          e instanceof Error ? e.message : 'network_error',
        );
      }
    } finally {
      setVerticallySynthesizing(false);
      verticalSynthAbortRef.current = null;
    }
  }

  async function runSummarize(result: AnalysisResult) {
    if (result.rows.length === 0) return;
    setSummarizing(true);
    setSummarizeError(null);
    const ac = new AbortController();
    summarizeAbortRef.current = ac;
    try {
      const res = await fetch('/api/interviews/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: result.rows }),
        signal: ac.signal,
      });
      const json = await res.json();
      if (!res.ok) {
        const issue = Array.isArray(json.issues) && json.issues[0];
        const detail = issue
          ? ` (${issue.path?.join('.')} ${issue.code})`
          : '';
        setSummarizeError((json.error ?? 'summarize_failed') + detail);
        return;
      }
      const summaries: unknown = json.summaries;
      if (!Array.isArray(summaries)) {
        setSummarizeError('invalid_response');
        return;
      }
      const rowsWithSummary: AnalysisRow[] = result.rows.map((row, idx) => ({
        ...row,
        summary:
          typeof summaries[idx] === 'string' ? (summaries[idx] as string) : '',
      }));
      setAnalysis((prev) => {
        if (!prev) return prev;
        return { ...prev, rows: rowsWithSummary };
      });
      // Chain vertical synthesis — operates on the row list we just built
      // so we don't depend on React having flushed setAnalysis yet.
      void runVerticalSynth(rowsWithSummary);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setSummarizeError(e instanceof Error ? e.message : 'network_error');
      }
    } finally {
      setSummarizing(false);
      summarizeAbortRef.current = null;
    }
  }

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
      // Fire row-level summary as a follow-up — table renders immediately,
      // 요약 column fills in when the second LLM call returns.
      void runSummarize(result);
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

  const isWorking =
    convertingAll ||
    analyzing ||
    summarizing ||
    verticallySynthesizing ||
    items.some((i) => i.extractStatus === 'extracting');

  const verticalDone = !!(
    analysis?.consolidated && analysis.consolidated.length > 0
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

  // Result type carrying everything the analyze pipeline needs without
  // having to re-read itemsRef (which lags behind setItems by a render).
  type ConvertedFile = { id: string; file: File; markdown: string };

  async function convertOne(
    id: string,
    snapshot: ConvItem[],
  ): Promise<ConvertedFile | null> {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, status: 'converting', error: undefined } : i,
      ),
    );
    const target = snapshot.find((i) => i.id === id);
    if (!target) return null;
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
        return null;
      }
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
      return { id, file: target.file, markdown: json.markdown };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network_error';
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: 'error', error: msg } : i,
        ),
      );
      return null;
    }
  }

  // extractOne now takes the file/markdown directly — no more snapshot
  // lookup. The previous design read from a `snapshot` arg or itemsRef,
  // which suffered from React stale-ref: after the last convertOne setItems
  // hadn't flushed yet, ready arrays missed the last file and extractOne
  // was never invoked for it. Passing data explicitly removes that race.
  async function extractOne(
    id: string,
    file: File,
    markdown: string,
  ): Promise<ExtractItem[] | null> {
    if (!markdown) return null;

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, extractStatus: 'extracting', extractError: undefined }
          : i,
      ),
    );

    pushThinking({
      type: 'reading',
      filename: file.name,
      chars: markdown.length,
    });
    const snippet = markdown.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (snippet) {
      pushThinking({ type: 'snippet', filename: file.name, text: snippet });
    }

    let liveItems: ExtractItem[] = [];

    try {
      const res = await fetch('/api/interviews/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          markdown,
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
            filename: file.name,
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

    // Verbatim verification (best-effort, non-destructive).
    // Earlier we blanked the voc when its whitespace-normalised text was
    // not a substring of the source. That was too strict for files where
    // the markdown shape (CSV, list, survey export) differs from the
    // model's quote text — Sonnet at temp 0.1 with explicit "copy from
    // source" instruction rarely hallucinates, and a near-miss is far
    // more useful than an empty cell. Keep the voc, just count misses
    // so the file pill can flag suspicious output.
    const normSrc = markdown.replace(/\s+/g, ' ').trim();
    let invalid = 0;
    const verified: ExtractItem[] = liveItems.map((it) => {
      const v = (it.voc ?? '').trim();
      if (!v) return { ...it, voc: '' };
      const normV = v.replace(/\s+/g, ' ').trim();
      if (!normSrc.includes(normV)) invalid += 1;
      return it;
    });

    pushThinking({
      type: 'complete',
      filename: file.name,
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
    // Collect successfully-converted files directly from convertOne's
    // return value. Reading from itemsRef after the loop missed the last
    // file because React hadn't yet flushed the final setItems → useEffect
    // → itemsRef.current update by the time the auto-chain ran.
    const justConverted: ConvertedFile[] = [];
    for (const id of queue) {
      const result = await convertOne(id, itemsRef.current);
      if (result) justConverted.push(result);
    }
    setConvertingAll(false);
    router.refresh();

    // Combine with any files that were already done before this batch
    // (user converted earlier, then queued more). Use itemsRef for those —
    // its lag doesn't matter for files that were stable before this run.
    const queuedSet = new Set(queue);
    const previouslyDone: ConvertedFile[] = itemsRef.current
      .filter(
        (i) =>
          !queuedSet.has(i.id) &&
          i.status === 'done' &&
          typeof i.markdown === 'string' &&
          i.markdown.length > 0,
      )
      .map((i) => ({ id: i.id, file: i.file, markdown: i.markdown! }));
    const ready = [...previouslyDone, ...justConverted];
    if (ready.length === 0) return;

    track('interview_analyze_start', { fileCount: ready.length });
    setThinkingLog([]);
    void runAnalyzePipeline(ready);
  }

  function startAnalyze() {
    requireAuth(() => {
      const ready: ConvertedFile[] = itemsRef.current
        .filter(
          (i) =>
            i.status === 'done' &&
            typeof i.markdown === 'string' &&
            i.markdown.length > 0,
        )
        .map((i) => ({ id: i.id, file: i.file, markdown: i.markdown! }));
      track('interview_analyze_start', { fileCount: ready.length });
      setThinkingLog([]);
      void runAnalyzePipeline(ready);
    });
  }

  async function runAnalyzePipeline(ready: ConvertedFile[]) {
    if (ready.length === 0) return;

    const extractions: { filename: string; items: ExtractItem[] }[] = [];
    for (const cf of ready) {
      const extracted = await extractOne(cf.id, cf.file, cf.markdown);
      if (extracted) {
        extractions.push({ filename: cf.file.name, items: extracted });
      }
    }
    if (extractions.length === 0) return;

    pushThinking({ type: 'aggregate_start' });
    currentFilenamesRef.current = extractions.map((e) => e.filename);
    submit({ extractions });
  }

  function exportCsv() {
    if (!analysis || !filenameOrder.length) return;
    // CSV is single-sheet by format — emit the final summary view.
    triggerDownload(
      makeCsvBlob(buildFinalMatrix(analysis)),
      'interview-analysis.csv',
    );
  }
  function exportXlsx() {
    if (!analysis || !filenameOrder.length) return;
    // Sheet 1: final summary (문항, 요약). Sheet 2: 응답자별 행렬 with the
    // horizontal summary preserved (vertical summary intentionally omitted
    // so sheet 2 stays the "raw" cross-respondent matrix).
    triggerDownload(
      makeXlsxBlob([
        { name: '최종 요약', matrix: buildFinalMatrix(analysis) },
        {
          name: '응답자별',
          matrix: buildRespondentMatrix(analysis, filenameOrder),
        },
      ]),
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
    summarizing,
    summarizeError,
    verticallySynthesizing,
    verticalSynthError,
    verticalDone,
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
