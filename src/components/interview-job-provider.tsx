'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { useRouter } from '@/i18n/navigation';
import { useRequireAuth } from './auth-provider';
import { track } from './mixpanel-provider';
import { interviewMatrixSchema } from '@/lib/interview-schema';

const MAX_BYTES = 25 * 1024 * 1024;

export type ConvStatus = 'queued' | 'converting' | 'done' | 'error';
export type ExtractStatus = 'idle' | 'extracting' | 'done' | 'error';

export type ExtractItem = {
  question: string;
  summary: string;
  verbatim: string;
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
  cells: { filename: string; summary: string; voc: string }[];
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

type Ctx = {
  items: ConvItem[];
  filenameOrder: string[];
  queuedCount: number;
  doneCount: number;
  convertingAll: boolean;
  analyzing: boolean;
  analysis: AnalysisResult | null;
  analyzeError: string | null;
  // Whether any background work is in flight — drives the topbar pill.
  isWorking: boolean;
  addFiles: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  toggleExpand: (id: string) => void;
  startConvertAll: () => void;
  startAnalyze: () => void;
  stopAnalyze: () => void;
};

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

  function startConvertAll() {
    requireAuth(() => {
      void runConvertAll();
    });
  }

  async function runConvertAll() {
    if (convertingAll) return;
    setConvertingAll(true);
    const snapshot = items;
    const queue = snapshot
      .filter((i) => i.status === 'queued')
      .map((i) => i.id);
    for (const id of queue) {
      await convertOne(id, snapshot);
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

  async function runAnalyzePipeline() {
    const snapshot = items;
    const ready = snapshot.filter((i) => i.status === 'done' && i.markdown);
    if (ready.length === 0) return;

    const extractions: { filename: string; items: ExtractItem[] }[] = [];
    for (const file of ready) {
      const extracted = await extractOne(file.id, snapshot);
      if (extracted) {
        extractions.push({ filename: file.file.name, items: extracted });
      }
    }
    if (extractions.length === 0) return;

    submit({ extractions });
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
    addFiles,
    remove,
    clear,
    toggleExpand,
    startConvertAll,
    startAnalyze,
    stopAnalyze,
  };

  return (
    <InterviewJobContext.Provider value={value}>
      {children}
    </InterviewJobContext.Provider>
  );
}
