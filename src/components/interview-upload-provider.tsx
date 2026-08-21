'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  mapWithConcurrency,
  fetchWithRateLimitRetry,
} from '@/lib/upload-queue';
// Type only — the runtime module is dynamically imported inside expandZips so
// the non-ZIP upload path never pulls jszip into the bundle eagerly.
import type JSZipInstance from 'jszip';

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

// ── ZIP auto-unpack (pr-iv-zip-upload) ────────────────────────────────────
// A .zip dropped on the uploader is expanded IN THE BROWSER just before the
// batch enters the convert queue: each supported inner file becomes a real
// File and flows through the existing convert → index pipeline unchanged
// (server/DB/index logic all untouched). JSZip is already a dependency and
// loaded on demand so the non-ZIP path pays nothing.
//
// Supported inner extensions mirror the uploader's ACCEPT list + file-extract's
// classifier (text / doc / pdf / audio / video). ZIP entries carry no MIME, so
// the extension → MIME map below re-stamps each extracted File.type; that is
// what the server's classifyFile() reads to route audio/video vs. document.
const ZIP_INNER_MIME: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  weba: 'audio/webm',
  // video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function guessMime(name: string): string {
  return ZIP_INNER_MIME[extOf(name)] ?? '';
}

function isSupportedInner(name: string): boolean {
  return extOf(name) in ZIP_INNER_MIME;
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || '';
}

// Mac/Windows archive cruft that must never become a document.
function isArchiveNoise(path: string): boolean {
  if (path.includes('__MACOSX/') || path.startsWith('__MACOSX')) return true;
  const base = baseName(path);
  if (!base) return true;
  if (base === '.DS_Store' || base === 'Thumbs.db') return true;
  if (base.startsWith('._')) return true; // AppleDouble
  return false;
}

function isZipFile(f: File): boolean {
  return (
    f.type === 'application/zip' ||
    f.type === 'application/x-zip-compressed' ||
    f.name.toLowerCase().endsWith('.zip')
  );
}

// Display-name uniquifier for extracted files: flattening `sub/a.txt` to
// `a.txt` can collide, so a taken name gets a path hint → `a (sub).txt`.
// Indexing re-dedupes by content_hash server-side; this only keeps the batch
// UI rows distinct.
function uniquifyName(base: string, used: Set<string>, dirHint: string): string {
  if (!used.has(base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const hint = dirHint ? ` (${dirHint})` : '';
  let candidate = `${stem}${hint}${ext}`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${stem}${hint} ${n}${ext}`;
    n += 1;
  }
  return candidate;
}

// One flattened upload entry. `file: null` marks a synthetic error placeholder
// (corrupt / empty ZIP) that surfaces as an 'error' batch row without a File.
type PlanSource = {
  file: File | null;
  name: string;
  error: string | null;
  fromZip: boolean;
};

// Expand any ZIPs in `files` into their supported inner files, flattening the
// list the convert pipeline sees. Extraction is per-file sequential
// (`entry.async('blob')`) so a huge archive isn't fully materialised at once.
// Nested ZIPs are not recursed (their `.zip` ext isn't supported → skipped),
// guarding against zip-bomb recursion.
async function expandZips(files: File[]): Promise<PlanSource[]> {
  const out: PlanSource[] = [];
  const used = new Set<string>();
  for (const f of files) {
    if (!isZipFile(f)) {
      used.add(f.name);
      out.push({ file: f, name: f.name, error: null, fromZip: false });
      continue;
    }
    let zip: JSZipInstance;
    try {
      const JSZip = (await import('jszip')).default;
      zip = await JSZip.loadAsync(f);
    } catch {
      // Corrupt / password-protected — surface as an item error, keep the batch.
      out.push({ file: null, name: f.name, error: 'bad_zip', fromZip: true });
      continue;
    }
    type ZipEntry = (typeof zip.files)[string];
    const entries: { path: string; entry: ZipEntry }[] = [];
    zip.forEach((relativePath, entry) => {
      entries.push({ path: relativePath, entry });
    });
    let extracted = 0;
    for (const { path, entry } of entries) {
      if (entry.dir) continue;
      if (isArchiveNoise(path)) continue;
      const base = baseName(path);
      if (!isSupportedInner(base)) continue; // unsupported_in_zip → skip silently
      const blob = await entry.async('blob');
      const dirHint = path
        .slice(0, path.length - base.length)
        .replace(/\/+$/, '');
      const name = uniquifyName(base, used, dirHint);
      used.add(name);
      out.push({
        file: new File([blob], name, { type: guessMime(base) }),
        name,
        error: null,
        fromZip: true,
      });
      extracted += 1;
    }
    if (extracted === 0) {
      // Empty ZIP or nothing indexable inside — item error, batch continues.
      out.push({ file: null, name: f.name, error: 'empty_zip', fromZip: true });
    }
  }
  return out;
}

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

  // ── DB-driven convergence poll (shared by restore + live batches) ─────────
  // Polls the project's documents and reflects each doc's index_status onto the
  // batch's non-terminal files until everything is terminal (or the window
  // expires). Two callers:
  //   · restore (after a hard refresh) — the in-memory convert loop is gone, so
  //     the persisted batch is driven entirely from the DB.
  //   · live convergence (증상 A) — a client /index request that timed out or
  //     errored does NOT mean the file failed: the server route runs to
  //     maxDuration and may still be embedding. Instead of freezing those files
  //     as 'error' (the false "인덱싱 실패" banner), we keep them 'indexing' and
  //     let this poll converge them to the real server truth (done / error).
  const startDocPoll = useCallback(
    (batchId: string, projectId: string) => {
      if (restoreTimers.current.has(batchId)) return;
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
              if (b.id !== batchId) return b;
              const files = b.files.map((f) => {
                // Files already terminal (done/duplicate at index time, or a
                // convert-stage 'error') keep their status; otherwise take the
                // DB truth if the doc exists.
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
            const timer = restoreTimers.current.get(batchId);
            if (timer) clearInterval(timer);
            restoreTimers.current.delete(batchId);
            setBatches((prev) =>
              prev.map((b) => (b.id === batchId ? { ...b, done: true } : b)),
            );
          }
        } catch {
          // transient — keep polling until the deadline
        }
      };

      void tick();
      const timer = setInterval(() => void tick(), 2500);
      restoreTimers.current.set(batchId, timer);
    },
    [bumpSignal],
  );

  // ── Core pipeline (ported verbatim from useInterviewV2Upload.uploadMany) ──
  const runBatch = useCallback(
    async (
      batchId: string,
      files: File[],
      projectId: string,
      existingFilenames: string[],
    ): Promise<void> => {
      // Expand any ZIPs into their inner files FIRST, so the rest of the
      // pipeline (dedupe, convert, index) is file-type agnostic. A ZIP row is
      // replaced by its N extracted rows; a corrupt/empty ZIP becomes a single
      // error row. Non-ZIP uploads pass through untouched.
      const sources = await expandZips(files);
      if (sources.length === 0) {
        markBatchDone(batchId, projectId);
        return;
      }
      // Reflect the (possibly expanded) file list onto the batch so the UI
      // shows one row per inner file instead of the ZIP name.
      setBatches((prev) =>
        prev.map((b) =>
          b.id === batchId
            ? {
                ...b,
                files: sources.map((s) => ({
                  name: s.name,
                  status: 'queued' as const,
                })),
              }
            : b,
        ),
      );

      // Client pre-filter (UX + convert cost). Indices stay aligned with the
      // batch file list so per-file status maps 1:1.
      const existing = new Set(existingFilenames);
      const seenKeys = new Set<string>();
      const plan = sources.map((s) => {
        if (s.error || !s.file) {
          return { ...s, duplicate: false };
        }
        const key = `${s.name}::${s.file.size}::${s.file.lastModified}`;
        const duplicate = existing.has(s.name) || seenKeys.has(key);
        seenKeys.add(key);
        return { ...s, duplicate };
      });

      if (plan.every((p) => p.duplicate)) {
        // Reflect the dedup in per-file status so the completion breakdown reads
        // "총 N · 중복 N" instead of leaving these files stuck at 'queued'.
        setFilesWhere(batchId, () => true, 'duplicate');
        markBatchDone(batchId, projectId);
        return;
      }

      // 1. Convert each non-duplicate file to markdown through a bounded queue.
      const converted = await mapWithConcurrency(
        plan,
        CONVERT_CONCURRENCY,
        async ({ file, duplicate, error }, index): Promise<ConvertOutcome> => {
          if (error || !file) {
            // Synthetic error row (corrupt / empty ZIP). Terminal 'error' so the
            // batch reflects it without a File to convert; the batch continues.
            setFileStatus(batchId, index, 'error');
            return { kind: 'fail', index, reason: error ?? 'zip_extract_failed' };
          }
          if (duplicate) {
            // Client-side dedup: mark 'duplicate' (terminal) so the batch
            // counts it as a duplicate, not a stuck 'queued'/processing file.
            setFileStatus(batchId, index, 'duplicate');
            return { kind: 'skip', index };
          }
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
                  .map((p) => ({ filename: p.name })),
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

      // Set when a client /index request fails without proof of server failure
      // (timeout / transient) — the batch then converges from the DB (증상 A)
      // instead of being declared done with false 'error' files.
      let needsDbConverge = false;

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
            const allChunkSkipped = serverSkipped >= chunk.length;

            setFilesWhere(
              batchId,
              (i) => chunkSet.has(i),
              allChunkSkipped ? 'duplicate' : 'done',
            );
            bumpSignal(projectId);
          } catch {
            lastIndexReason = chunkReason;
            // 증상 A: the client request failed, but /api/interviews/index runs
            // to maxDuration=300s server-side and may still be embedding. Do NOT
            // freeze these files as 'error' (that's the false "인덱싱 실패"
            // banner). Keep them 'indexing' and let startDocPoll converge them to
            // the real per-document index_status. A convert-stage failure (server
            // never reached) is already 'error' from the convert loop above and
            // is left untouched here.
            setFilesWhere(batchId, (i) => chunkSet.has(i), 'indexing');
            needsDbConverge = true;
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
        if (needsDbConverge) {
          // Some chunks timed out — converge the batch from the DB rather than
          // declaring it done now (which would surface the false-fail files).
          startDocPoll(batchId, projectId);
        } else {
          markBatchDone(batchId, projectId);
        }
      }
    },
    [bumpSignal, markBatchDone, setFileStatus, setFilesWhere, startDocPoll],
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
    for (const b of restored) startDocPoll(b.id, b.projectId);
  }, [startDocPoll]);

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
