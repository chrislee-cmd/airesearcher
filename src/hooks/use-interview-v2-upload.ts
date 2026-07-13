'use client';

import { useCallback, useState } from 'react';
import {
  mapWithConcurrency,
  fetchWithRateLimitRetry,
} from '@/lib/upload-queue';

// Interview V2 — client-side upload pipeline for the project-detail view.
//
// Wires the two pre-existing (already-deployed) backend routes into one
// batch flow, injecting the current project_id so each file lands in
// interview_documents scoped to the project:
//
//   files → POST /api/interviews/convert (per-file, bounded queue) → markdown
//         → POST /api/interviews/jobs    (one job for the batch)    → job id
//         → POST /api/interviews/index   (project_id + markdown)    → chunk+embed
//
// The hook owns per-file progress so the upload modal can render a status
// pill per file. Convert runs through a bounded-concurrency queue (not
// Promise.all) so a big batch never fires N convert POSTs at once — that
// burst tripped the app's own per-user LLM rate limit (30/min) and 429'd the
// overflow, self-DoSing normal use. On top of the concurrency cap every call
// (convert/jobs/index) auto-retries on 429, honouring the server's Retry-After
// so a batch larger than the per-minute cap simply drains over a few minutes
// instead of failing. A file that still fails to convert is marked 'error' and
// excluded from the (single, batched) index call so the rest of the batch
// still indexes.
//
// Note on the jobs API: /api/interviews/jobs is the interview-analysis
// snapshot endpoint (requires inputs/extractions/matrix, returns { id }).
// V2 upload has no matrix, so we create a minimal job row (empty
// extractions/matrix) purely to own the index_status the file list reads
// back via interview_jobs.index_status.
//
// Which "project_id" goes where — this is a real footgun. There are two
// distinct project tables:
//   * public.projects          — legacy workspace "active project"
//   * public.interview_projects — Interview V2 grouping (this feature)
// generations.project_id and interview_jobs.project_id both FK the LEGACY
// projects table, so sending a V2 (interview_projects) id there raises a
// 23503 foreign-key violation that surfaces as a 500 from /convert and the
// jobs insert. Only interview_documents.project_id references
// interview_projects (see 20260702144738_interview_documents_project_fk_to_v2).
// So the V2 projectId is passed to /index ONLY; convert and jobs stay
// project-less (which is also the legacy behaviour they already handle).

export type UploadFileStatus =
  // Accepted for upload but still behind the bounded-concurrency queue —
  // waiting for a convert slot. Shown so a large batch reads as "처리 중,
  // 순차 진행" rather than looking frozen.
  | 'queued'
  | 'converting'
  // Hit the app's per-user rate limit (429) and is backing off before an
  // automatic retry. Distinct from 'error' — nothing failed, it's just pacing.
  | 'retrying'
  | 'indexing'
  | 'done'
  | 'error'
  // Filtered out before convert (client pre-filter) — the file is a duplicate
  // of another file in the same selection or one already in the project. Shown
  // as "중복 — 건너뜀", never silently dropped.
  | 'duplicate';

export type UploadResult = {
  // True when at least one file made it through indexing (or a partial server
  // failure leaves the list needing reconciliation) — the caller refetches.
  changed: boolean;
  // Total files skipped as duplicates: client pre-filter + server-side
  // content-hash dedupe. Drives the completion summary.
  skipped: number;
};

export type UploadFileState = {
  name: string;
  status: UploadFileStatus;
};

type ConvertResult = {
  index: number;
  filename: string;
  markdown: string;
  mime: string | null;
};

const MAX_BYTES = 25 * 1024 * 1024;

// Max convert POSTs in flight at once. Deliberately well under the server's
// per-user LLM cap (30/min) so a normal small batch still converts near-
// instantly while a large one can't burst past the limit. Bigger batches lean
// on the 429 retry-after backoff below to drain the remainder.
const CONVERT_CONCURRENCY = 3;

// Max documents per index POST. The server caps /api/interviews/index at
// `documents.max(50)` (see src/app/api/interviews/index/route.ts Body schema),
// so a batch over 50 sent as one POST fails zod validation with a 400 and the
// whole batch reads as "인덱싱 실패" — the production incident this fixes. Split
// `ok` into chunks under that ceiling and POST each chunk. 40 keeps a margin
// below 50 and eases per-call embedding load within the route's
// maxDuration=300 budget. KEEP IN SYNC with the server's Body.documents.max(50).
const INDEX_CHUNK_SIZE = 40;

export function useInterviewV2Upload() {
  const [items, setItems] = useState<UploadFileState[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setItems([]);
    setBusy(false);
  }, []);

  const setStatusAt = useCallback((index: number, status: UploadFileStatus) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, status } : it)),
    );
  }, []);

  // Returns { changed, skipped }. changed drives the caller's refetch; skipped
  // is the duplicate count for the completion summary.
  //
  // projectId is REQUIRED — this is the whole point of the project-setup
  // gate. Without it the indexed rows would land with a null
  // interview_documents.project_id and never show up in the V2 fullview
  // (which filters by project). The UI gate (upload modal Step 2) makes
  // this unreachable; the guard is a last-resort net that refuses the
  // batch rather than silently orphaning the files.
  //
  // existingFilenames — filenames already in the project (from the loaded
  // document list). Used only for the client pre-filter below; the server's
  // project-scoped content-hash dedupe is the real guarantee, so callers that
  // don't have the list can omit it and correctness is unaffected.
  const uploadMany = useCallback(
    async (
      files: File[],
      projectId: string,
      existingFilenames: string[] = [],
    ): Promise<UploadResult> => {
      if (!projectId || files.length === 0 || busy)
        return { changed: false, skipped: 0 };
      setBusy(true);

      // Client pre-filter (UX + convert cost). Marks a file 'duplicate' — and
      // skips converting it — when it's an obvious duplicate:
      //   1. selection-internal: same (name+size+lastModified) picked twice.
      //   2. filename collision with a file already in the project.
      // Content-based matches the client can't see (same content, different
      // name) are still caught server-side. Indices stay aligned with `files`
      // so the per-file status pills map 1:1.
      const existing = new Set(existingFilenames);
      const seenKeys = new Set<string>();
      const plan = files.map((f) => {
        const key = `${f.name}::${f.size}::${f.lastModified}`;
        const duplicate = existing.has(f.name) || seenKeys.has(key);
        seenKeys.add(key);
        return { file: f, duplicate };
      });
      let skipped = plan.filter((p) => p.duplicate).length;

      setItems(
        plan.map((p) => ({
          name: p.file.name,
          // Non-duplicates start 'queued' (waiting for a convert slot); the
          // worker flips each to 'converting' when it actually starts, so the
          // UI shows the queue draining a few at a time instead of every file
          // claiming to convert at once.
          status: p.duplicate ? 'duplicate' : 'queued',
        })),
      );

      if (plan.every((p) => p.duplicate)) {
        // Nothing new to upload — all picks were duplicates.
        setBusy(false);
        return { changed: false, skipped };
      }

      // 1. Convert each non-duplicate file to markdown through a bounded queue
      //    (CONVERT_CONCURRENCY at a time) instead of Promise.all — the old
      //    all-at-once fan-out is what tripped the per-user rate limit. A
      //    per-file failure is isolated — mark it 'error' and drop it, never
      //    reject the batch. Duplicates are left as-is ('duplicate').
      const converted = await mapWithConcurrency(
        plan,
        CONVERT_CONCURRENCY,
        async ({ file, duplicate }, index): Promise<ConvertResult | null> => {
          if (duplicate) return null;
          if (file.size === 0 || file.size > MAX_BYTES) {
            setStatusAt(index, 'error');
            return null;
          }
          // Leaving the queue — actually converting now.
          setStatusAt(index, 'converting');
          try {
            // No project_id here: convert writes generations.project_id,
            // which FKs the legacy projects table (not interview_projects).
            const fd = new FormData();
            fd.append('file', file);
            // 429 (per-user LLM cap) is not a failure — back off for the
            // server's Retry-After and retry. Surface 'retrying' so the file
            // reads as "재시도 대기", not stuck.
            const res = await fetchWithRateLimitRetry(
              '/api/interviews/convert',
              { method: 'POST', body: fd },
              { onRetry: () => setStatusAt(index, 'retrying') },
            );
            if (!res.ok) throw new Error(`convert_${res.status}`);
            const j = (await res.json()) as {
              markdown?: string;
              filename?: string;
            };
            if (!j.markdown) throw new Error('convert_empty');
            return {
              index,
              filename: j.filename ?? file.name,
              markdown: j.markdown,
              mime: file.type || null,
            };
          } catch {
            setStatusAt(index, 'error');
            return null;
          }
        },
      );

      const ok = converted.filter((c): c is ConvertResult => c !== null);
      if (ok.length === 0) {
        setBusy(false);
        return { changed: false, skipped };
      }

      // Flip the successfully-converted files to 'indexing' before the
      // (single) batched index call.
      setItems((prev) =>
        prev.map((it, i) =>
          ok.some((c) => c.index === i) ? { ...it, status: 'indexing' } : it,
        ),
      );

      try {
        // 2. Create the interview_job that owns this batch's index_status.
        //    project_id stays null — interview_jobs.project_id FKs the legacy
        //    projects table, and this batch is scoped to a V2 project instead.
        //    inputs.mime is omitted when the browser reports no type (empty
        //    string): the jobs schema's mime is `z.string().optional()`, which
        //    rejects null and would 400 the whole batch (common for .md/.txt).
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

        // 3. Index — project_id injected so interview_documents rows are
        //    scoped to this project. Chunk + embed happens server-side.
        //    The server caps documents at 50 per POST, so split `ok` into
        //    chunks under that ceiling and POST each one sequentially, all
        //    sharing this batch's interview_job_id / project_id. A single
        //    chunk failing marks only that chunk's files 'error'; the rest
        //    keep going so one bad chunk can't fail the whole batch.
        const chunks: ConvertResult[][] = [];
        for (let i = 0; i < ok.length; i += INDEX_CHUNK_SIZE) {
          chunks.push(ok.slice(i, i + INDEX_CHUNK_SIZE));
        }

        // At least one file actually indexed (not all-skipped) → refetch.
        let anyIndexed = false;
        // A chunk failed partway → the list needs reconciling even if other
        // chunks all-skipped, so force a refetch.
        let anyError = false;

        for (const chunk of chunks) {
          const chunkIdx = new Set(chunk.map((c) => c.index));
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
                // Index shares the per-user LLM budget the convert burst just
                // spent — a 429 here is likely. Back off and surface
                // 'retrying' on this chunk's in-flight files.
                onRetry: () =>
                  setItems((prev) =>
                    prev.map((it, i) =>
                      chunkIdx.has(i) ? { ...it, status: 'retrying' } : it,
                    ),
                  ),
              },
            );
            if (!indexRes.ok) throw new Error(`index_${indexRes.status}`);

            // Server-side project-scoped content-hash dedupe may have skipped
            // some converted files (same content, possibly renamed —
            // undetectable by the client pre-filter). The response only carries
            // an aggregate count, not which rows, so we fold it into the summary
            // total. If the server skipped everything in this chunk, mark those
            // files 'duplicate'; otherwise they flip to 'done' (we can't pin the
            // aggregate to specific rows).
            const idxJson = (await indexRes.json().catch(() => ({}))) as {
              skipped_count?: number;
            };
            const serverSkipped = idxJson.skipped_count ?? 0;
            skipped += serverSkipped;
            const allChunkSkipped = serverSkipped >= chunk.length;
            if (!allChunkSkipped) anyIndexed = true;

            setItems((prev) =>
              prev.map((it, i) =>
                chunkIdx.has(i)
                  ? { ...it, status: allChunkSkipped ? 'duplicate' : 'done' }
                  : it,
              ),
            );
          } catch {
            anyError = true;
            // Isolate the failure to this chunk — the other chunks already
            // committed their status and must not be reverted.
            setItems((prev) =>
              prev.map((it, i) =>
                chunkIdx.has(i) ? { ...it, status: 'error' } : it,
              ),
            );
          }
        }

        setBusy(false);
        // changed when at least one file actually indexed, or a chunk failed
        // partway (the list needs reconciling to reflect what did land). All
        // chunks all-skipped with no error → nothing new, no refetch.
        return { changed: anyIndexed || anyError, skipped };
      } catch {
        // Reached only when job creation (or something before the chunk loop)
        // throws — none of the files could be indexed, so mark them all 'error'.
        setItems((prev) =>
          prev.map((it, i) =>
            ok.some((c) => c.index === i) ? { ...it, status: 'error' } : it,
          ),
        );
        setBusy(false);
        // Nothing landed, but signal a refetch so the list reconciles in case
        // a prior partial attempt left rows behind.
        return { changed: true, skipped };
      }
    },
    [busy, setStatusAt],
  );

  return { items, busy, uploadMany, reset };
}
