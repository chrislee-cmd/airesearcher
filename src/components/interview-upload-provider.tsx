'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast-provider';
import {
  mapWithConcurrency,
  fetchWithRateLimitRetry,
} from '@/lib/upload-queue';

// Interview V2 — background upload orchestration, lifted out of the upload
// modal (pr-interview-upload-background-progress-artifact).
//
// WHY this exists: the upload used to run inside <UploadModal>, which blocked
// the app (modal couldn't be closed while `busy`) and dropped all progress the
// moment the modal closed. The convert loop + per-file/aggregate status now
// live in this app-level provider (mounted in the (app) layout, so it never
// unmounts across navigation). The modal is reduced to a file/project picker:
// on submit it hands the batch here and closes immediately, and a persistent
// docked artifact (<InterviewUploadArtifact>) renders progress from here.
//
// The convert → jobs → index pipeline is preserved VERBATIM from the old
// useInterviewV2Upload hook — same bounded-concurrency convert queue (#975),
// 429 retry-after backoff (#986), 50-doc index chunking (#999/#1012), client +
// server dedupe, and the OBS observability writes (#1007). Only the OWNER of
// the per-file status moved (modal → provider).
//
// project_id routing footgun (unchanged): convert/jobs write
// generations/interview_jobs.project_id which FK the LEGACY projects table, so
// they stay project-less; only /index receives the V2 interview_projects id
// (interview_documents.project_id FKs interview_projects).

export type UploadFileStatus =
  | 'queued'
  | 'converting'
  | 'retrying'
  | 'indexing'
  | 'done'
  | 'error'
  | 'duplicate';

// Terminal = no more transitions expected for this file.
const TERMINAL: ReadonlySet<UploadFileStatus> = new Set([
  'done',
  'error',
  'duplicate',
]);

export type UploadBatchFile = { name: string; status: UploadFileStatus };

export type UploadBatch = {
  id: string;
  projectId: string;
  projectName: string | null;
  files: UploadBatchFile[];
  createdAt: number;
  // Rehydrated from localStorage after a hard refresh. A restored batch is
  // driven by DB document polling (the in-memory convert loop can't survive a
  // reload), so its files only reflect what actually reached the server.
  restored: boolean;
  // True once every file is terminal (done/error/duplicate).
  done: boolean;
};

type StartArgs = {
  files: File[];
  projectId: string;
  projectName?: string | null;
  existingFilenames?: string[];
};

type Ctx = {
  batches: UploadBatch[];
  startUpload: (args: StartArgs) => void;
  dismissBatch: (id: string) => void;
  // Per-project monotonic counter, bumped on every batch transition +
  // completion. Document lists subscribe to their project's value and refetch
  // so background progress (new indexing rows, done) shows without the caller
  // owning the upload. See useInterviewUploadSignal.
  uploadSignals: Record<string, number>;
};

const InterviewUploadContext = createContext<Ctx | null>(null);

export function useInterviewUpload() {
  const v = useContext(InterviewUploadContext);
  if (!v) {
    throw new Error(
      'useInterviewUpload must be used inside <InterviewUploadProvider>',
    );
  }
  return v;
}

// Safe optional read for consumers that may render outside the provider (e.g.
// the documents hook used in isolated tests). Returns 0 when absent.
export function useInterviewUploadSignal(projectId: string | null): number {
  const v = useContext(InterviewUploadContext);
  if (!v || !projectId) return 0;
  return v.uploadSignals[projectId] ?? 0;
}

const MAX_BYTES = 25 * 1024 * 1024;
// KEEP IN SYNC with the server's Body.documents.max(50) in
// src/app/api/interviews/index/route.ts. 40 keeps a margin below the 50 cap.
const INDEX_CHUNK_SIZE = 40;
// Well under the server's per-user LLM cap (30/min) so a normal batch converts
// near-instantly while a large one can't burst past the limit.
const CONVERT_CONCURRENCY = 3;

// localStorage key holding the compact list of live batches, so a refresh can
// re-surface in-flight indexing (DB-driven) instead of losing the artifact.
const STORAGE_KEY = 'interview-upload:batches:v1';
// Give up polling a restored batch after this long — a stuck server-side index
// shouldn't leave a zombie card forever.
const RESTORE_MAX_MS = 10 * 60 * 1000;

type ConvertResult = {
  index: number;
  filename: string;
  markdown: string;
  mime: string | null;
};
type ConvertOutcome =
  | (ConvertResult & { kind: 'ok' })
  | { kind: 'fail'; index: number; reason: string }
  | { kind: 'skip'; index: number };

async function readFailReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // fall through to status-based reason
  }
  return `http_${res.status}`;
}

function summarizeConvertFailures(
  reasons: string[],
  attempted: number,
): string {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const parts = [...counts.entries()].map(([r, n]) => `${r}×${n}`);
  return `convert_failed: ${reasons.length}/${attempted} (${parts.join(', ')})`;
}

async function markJobIndexError(
  jobId: string,
  message: string,
): Promise<void> {
  try {
    await fetch(`/api/interviews/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        index_status: 'error',
        error_message: message.slice(0, 500),
      }),
    });
  } catch {
    // swallow — observability, not correctness
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

// Map a DB document index_status onto a batch file status (restore path).
function statusFromDoc(
  indexStatus: 'pending' | 'indexing' | 'done' | 'error',
): UploadFileStatus {
  switch (indexStatus) {
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'indexing':
      return 'indexing';
    default:
      return 'queued';
  }
}

export function InterviewUploadProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations('InterviewsV2');
  const { push } = useToast();
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [uploadSignals, setUploadSignals] = useState<Record<string, number>>(
    {},
  );
  // Active restore pollers keyed by batch id — cleared on dismiss/terminal.
  const restoreTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );

  const bumpSignal = useCallback((projectId: string) => {
    setUploadSignals((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] ?? 0) + 1,
    }));
  }, []);

  // Update one batch's file at `index`, then bump the project signal so
  // subscribed document lists refetch.
  const setFileStatus = useCallback(
    (batchId: string, index: number, status: UploadFileStatus) => {
      setBatches((prev) =>
        prev.map((b) =>
          b.id === batchId
            ? {
                ...b,
                files: b.files.map((f, i) =>
                  i === index ? { ...f, status } : f,
                ),
              }
            : b,
        ),
      );
    },
    [],
  );

  const setFilesWhere = useCallback(
    (
      batchId: string,
      pred: (index: number) => boolean,
      status: UploadFileStatus,
    ) => {
      setBatches((prev) =>
        prev.map((b) =>
          b.id === batchId
            ? {
                ...b,
                files: b.files.map((f, i) =>
                  pred(i) ? { ...f, status } : f,
                ),
              }
            : b,
        ),
      );
    },
    [],
  );

  const markBatchDone = useCallback(
    (batchId: string, projectId: string) => {
      setBatches((prev) =>
        prev.map((b) => (b.id === batchId ? { ...b, done: true } : b)),
      );
      bumpSignal(projectId);
    },
    [bumpSignal],
  );

  const dismissBatch = useCallback((id: string) => {
    const timer = restoreTimers.current.get(id);
    if (timer) {
      clearInterval(timer);
      restoreTimers.current.delete(id);
    }
    setBatches((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // ── Core pipeline (ported verbatim from useInterviewV2Upload.uploadMany) ──
  const runBatch = useCallback(
    async (
      batchId: string,
      files: File[],
      projectId: string,
      existingFilenames: string[],
    ): Promise<void> => {
      // Client pre-filter (UX + convert cost). Indices stay aligned with the
      // batch file list so per-file status maps 1:1.
      const existing = new Set(existingFilenames);
      const seenKeys = new Set<string>();
      const plan = files.map((f) => {
        const key = `${f.name}::${f.size}::${f.lastModified}`;
        const duplicate = existing.has(f.name) || seenKeys.has(key);
        seenKeys.add(key);
        return { file: f, duplicate };
      });
      let skipped = plan.filter((p) => p.duplicate).length;

      if (plan.every((p) => p.duplicate)) {
        markBatchDone(batchId, projectId);
        if (skipped > 0) {
          push(t('uploadSkippedSummary', { count: skipped }), { tone: 'info' });
        }
        return;
      }

      // 1. Convert each non-duplicate file to markdown through a bounded queue.
      const converted = await mapWithConcurrency(
        plan,
        CONVERT_CONCURRENCY,
        async ({ file, duplicate }, index): Promise<ConvertOutcome> => {
          if (duplicate) return { kind: 'skip', index };
          if (file.size === 0) {
            setFileStatus(batchId, index, 'error');
            return { kind: 'fail', index, reason: 'empty_file' };
          }
          if (file.size > MAX_BYTES) {
            setFileStatus(batchId, index, 'error');
            return { kind: 'fail', index, reason: 'file_too_large' };
          }
          setFileStatus(batchId, index, 'converting');
          bumpSignal(projectId);
          try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetchWithRateLimitRetry(
              '/api/interviews/convert',
              { method: 'POST', body: fd },
              { onRetry: () => setFileStatus(batchId, index, 'retrying') },
            );
            if (!res.ok) {
              const reason = await readFailReason(res);
              setFileStatus(batchId, index, 'error');
              return { kind: 'fail', index, reason };
            }
            const j = (await res.json()) as {
              markdown?: string;
              filename?: string;
            };
            if (!j.markdown) {
              setFileStatus(batchId, index, 'error');
              return { kind: 'fail', index, reason: 'convert_empty' };
            }
            return {
              kind: 'ok',
              index,
              filename: j.filename ?? file.name,
              markdown: j.markdown,
              mime: file.type || null,
            };
          } catch {
            setFileStatus(batchId, index, 'error');
            return { kind: 'fail', index, reason: 'network' };
          }
        },
      );

      const ok = converted.filter(
        (c): c is ConvertResult & { kind: 'ok' } => c.kind === 'ok',
      );
      const failReasons = converted
        .filter(
          (c): c is { kind: 'fail'; index: number; reason: string } =>
            c.kind === 'fail',
        )
        .map((c) => c.reason);
      const attempted = plan.filter((p) => !p.duplicate).length;

      if (ok.length === 0) {
        // Every non-duplicate file failed to convert → /index never runs.
        // Create a job row + stamp index_status='error' so the failure (and
        // its cause) is visible in DB/admin instead of leaving zero trace.
        if (failReasons.length > 0) {
          try {
            const jobRes = await fetch('/api/interviews/jobs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                project_id: null,
                inputs: plan
                  .filter((p) => !p.duplicate)
                  .map((p) => ({ filename: p.file.name })),
                extractions: {},
                matrix: {},
              }),
            });
            if (jobRes.ok) {
              const { id } = (await jobRes.json()) as { id?: string };
              if (id) {
                await markJobIndexError(
                  id,
                  summarizeConvertFailures(failReasons, attempted),
                );
              }
            }
          } catch {
            // best-effort — never let the observability write break the flow
          }
        }
        markBatchDone(batchId, projectId);
        return;
      }

      // Flip the successfully-converted files to 'indexing'.
      setFilesWhere(batchId, (i) => ok.some((c) => c.index === i), 'indexing');
      bumpSignal(projectId);

      try {
        // 2. Create the interview_job that owns this batch's index_status.
        const jobRes = await fetchWithRateLimitRetry('/api/interviews/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project_id: null,
            inputs: ok.map((c) => ({
              filename: c.filename,
              ...(c.mime ? { mime: c.mime } : {}),
            })),
            extractions: {},
            matrix: {},
          }),
        });
        if (!jobRes.ok) throw new Error(`jobs_${jobRes.status}`);
        const { id: interviewJobId } = (await jobRes.json()) as { id?: string };
        if (!interviewJobId) throw new Error('jobs_no_id');

        // 3. Index — project_id injected. Split into ≤INDEX_CHUNK_SIZE POSTs so
        //    a batch over the server's 50-doc cap doesn't 400 wholesale.
        const chunks: ConvertResult[][] = [];
        for (let i = 0; i < ok.length; i += INDEX_CHUNK_SIZE) {
          chunks.push(ok.slice(i, i + INDEX_CHUNK_SIZE));
        }

        let reachedIndexRoute = false;
        let lastIndexReason = 'network';

        for (const chunk of chunks) {
          const chunkSet = new Set(chunk.map((c) => c.index));
          let chunkReason = 'network';
          try {
            const indexRes = await fetchWithRateLimitRetry(
              '/api/interviews/index',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  interview_job_id: interviewJobId,
                  project_id: projectId,
                  documents: chunk.map((c) => ({
                    filename: c.filename,
                    mime: c.mime,
                    markdown: c.markdown,
                  })),
                }),
              },
              {
                onRetry: () =>
                  setFilesWhere(batchId, (i) => chunkSet.has(i), 'retrying'),
              },
            );
            if (indexRes.status === 200 || indexRes.status === 500) {
              reachedIndexRoute = true;
            }
            if (!indexRes.ok) {
              chunkReason = await readFailReason(indexRes);
              throw new Error(`index_${indexRes.status}`);
            }

            const idxJson = (await indexRes.json().catch(() => ({}))) as {
              skipped_count?: number;
            };
            const serverSkipped = idxJson.skipped_count ?? 0;
            skipped += serverSkipped;
            const allChunkSkipped = serverSkipped >= chunk.length;

            setFilesWhere(
              batchId,
              (i) => chunkSet.has(i),
              allChunkSkipped ? 'duplicate' : 'done',
            );
            bumpSignal(projectId);
          } catch {
            lastIndexReason = chunkReason;
            setFilesWhere(batchId, (i) => chunkSet.has(i), 'error');
            bumpSignal(projectId);
          }
        }

        // If the index route never ran for ANY chunk, the job row is still
        // 'pending' — stamp it 'error' with the cause (respects OBS-4: the
        // PATCH only writes while still 'pending').
        if (!reachedIndexRoute) {
          const msg =
            failReasons.length > 0
              ? `${summarizeConvertFailures(failReasons, attempted)}; index_unreached: ${lastIndexReason}`
              : `index_unreached: ${lastIndexReason}`;
          await markJobIndexError(interviewJobId, msg);
        }
      } catch {
        // Job creation (or something before the chunk loop) threw — none could
        // be indexed, so mark all the converted files 'error'.
        setFilesWhere(batchId, (i) => ok.some((c) => c.index === i), 'error');
      } finally {
        markBatchDone(batchId, projectId);
        if (skipped > 0) {
          push(t('uploadSkippedSummary', { count: skipped }), { tone: 'info' });
        }
      }
    },
    [bumpSignal, markBatchDone, push, setFileStatus, setFilesWhere, t],
  );

  const startUpload = useCallback(
    ({ files, projectId, projectName, existingFilenames }: StartArgs) => {
      if (!projectId || files.length === 0) return;
      const batchId = newId();
      const batch: UploadBatch = {
        id: batchId,
        projectId,
        projectName: projectName ?? null,
        files: files.map((f) => ({
          name: f.name,
          status: 'queued' as const,
        })),
        createdAt: Date.now(),
        restored: false,
        done: false,
      };
      setBatches((prev) => [...prev, batch]);
      void runBatch(batchId, files, projectId, existingFilenames ?? []);
    },
    [runBatch],
  );

  // ── Persist live (non-restored) batches so a refresh can re-surface the
  //    still-indexing ones from the DB. We store only what's needed to poll:
  //    id, project, createdAt, and per-file {name, status}. ─────────────────
  useEffect(() => {
    try {
      const live = batches
        .filter((b) => !b.restored)
        .map((b) => ({
          id: b.id,
          projectId: b.projectId,
          projectName: b.projectName,
          createdAt: b.createdAt,
          files: b.files,
        }));
      if (live.length === 0) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(live));
      }
    } catch {
      // storage unavailable — persistence is best-effort
    }
  }, [batches]);

  // ── Restore poller: for a rehydrated batch, poll the project's documents and
  //    reflect index_status per filename until everything is terminal (or the
  //    restore window expires). Only the indexing phase is DB-recoverable — the
  //    client-side convert loop can't survive a reload, so any file that never
  //    reached the server simply stays as its persisted status. ──────────────
  const startRestorePoll = useCallback((batch: UploadBatch) => {
    if (restoreTimers.current.has(batch.id)) return;
    const projectId = batch.projectId;
    const deadline = Date.now() + RESTORE_MAX_MS;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/interviews/v2/projects/${projectId}/documents`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          documents?: {
            filename: string;
            index_status: 'pending' | 'indexing' | 'done' | 'error';
          }[];
        };
        const byName = new Map(
          (j.documents ?? []).map((d) => [d.filename, d.index_status]),
        );
        let allTerminal = true;
        setBatches((prev) =>
          prev.map((b) => {
            if (b.id !== batch.id) return b;
            const files = b.files.map((f) => {
              // Files that were already terminal at persist time keep their
              // status; otherwise take the DB truth if the doc exists.
              if (TERMINAL.has(f.status)) return f;
              const docStatus = byName.get(f.name);
              const next = docStatus ? statusFromDoc(docStatus) : f.status;
              if (!TERMINAL.has(next)) allTerminal = false;
              return next === f.status ? f : { ...f, status: next };
            });
            return { ...b, files };
          }),
        );
        bumpSignal(projectId);
        if (allTerminal || Date.now() > deadline) {
          const timer = restoreTimers.current.get(batch.id);
          if (timer) clearInterval(timer);
          restoreTimers.current.delete(batch.id);
          setBatches((prev) =>
            prev.map((b) => (b.id === batch.id ? { ...b, done: true } : b)),
          );
        }
      } catch {
        // transient — keep polling until the deadline
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 2500);
    restoreTimers.current.set(batch.id, timer);
  }, [bumpSignal]);

  // Rehydrate persisted batches once on mount. Any batch that still has a
  // non-terminal file is re-surfaced as `restored` and polled from the DB.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: Array<{
      id: string;
      projectId: string;
      projectName: string | null;
      createdAt: number;
      files: UploadBatchFile[];
    }>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const restored: UploadBatch[] = parsed
      .filter(
        (b) =>
          Array.isArray(b.files) &&
          b.files.some((f) => !TERMINAL.has(f.status)),
      )
      .map((b) => ({
        id: b.id,
        projectId: b.projectId,
        projectName: b.projectName ?? null,
        files: b.files,
        createdAt: b.createdAt ?? Date.now(),
        restored: true,
        done: false,
      }));
    if (restored.length === 0) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-mount localStorage rehydrate (same probe pattern as use-consent.ts)
    setBatches((prev) => [...prev, ...restored]);
    for (const b of restored) startRestorePoll(b);
  }, [startRestorePoll]);

  // Clean up any live pollers on unmount (the provider lives for the whole
  // app session, so this only fires on full teardown — but keep it tidy).
  useEffect(() => {
    const timers = restoreTimers.current;
    return () => {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    };
  }, []);

  return (
    <InterviewUploadContext.Provider
      value={{ batches, startUpload, dismissBatch, uploadSignals }}
    >
      {children}
    </InterviewUploadContext.Provider>
  );
}
