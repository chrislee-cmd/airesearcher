'use client';

import { useCallback, useState } from 'react';

// Interview V2 — client-side upload pipeline for the project-detail view.
//
// Wires the two pre-existing (already-deployed) backend routes into one
// batch flow, injecting the current project_id so each file lands in
// interview_documents scoped to the project:
//
//   files → POST /api/interviews/convert (per-file, parallel) → markdown
//         → POST /api/interviews/jobs    (one job for the batch)  → job id
//         → POST /api/interviews/index   (project_id + markdown)  → chunk+embed
//
// The hook owns per-file progress so the upload modal can render a status
// pill per file. Convert runs in parallel; a file that fails to convert is
// marked 'error' and excluded from the (single, batched) index call so the
// rest of the batch still indexes.
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
  | 'converting'
  | 'indexing'
  | 'done'
  | 'error';

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

export function useInterviewV2Upload(projectId: string) {
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

  // Returns true when at least one file made it through indexing, so the
  // caller knows to refetch the document list.
  const uploadMany = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (files.length === 0 || busy) return false;
      setBusy(true);
      setItems(files.map((f) => ({ name: f.name, status: 'converting' })));

      // 1. Convert each file to markdown in parallel. A per-file failure is
      //    isolated — mark it 'error' and drop it, never reject the batch.
      const converted = await Promise.all(
        files.map(async (file, index): Promise<ConvertResult | null> => {
          if (file.size === 0 || file.size > MAX_BYTES) {
            setStatusAt(index, 'error');
            return null;
          }
          try {
            // No project_id here: convert writes generations.project_id,
            // which FKs the legacy projects table (not interview_projects).
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/interviews/convert', {
              method: 'POST',
              body: fd,
            });
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
        }),
      );

      const ok = converted.filter((c): c is ConvertResult => c !== null);
      if (ok.length === 0) {
        setBusy(false);
        return false;
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
        const jobRes = await fetch('/api/interviews/jobs', {
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
        const indexRes = await fetch('/api/interviews/index', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            interview_job_id: interviewJobId,
            project_id: projectId || null,
            documents: ok.map((c) => ({
              filename: c.filename,
              mime: c.mime,
              markdown: c.markdown,
            })),
          }),
        });
        if (!indexRes.ok) throw new Error(`index_${indexRes.status}`);

        setItems((prev) =>
          prev.map((it, i) =>
            ok.some((c) => c.index === i) ? { ...it, status: 'done' } : it,
          ),
        );
        setBusy(false);
        return true;
      } catch {
        setItems((prev) =>
          prev.map((it, i) =>
            ok.some((c) => c.index === i) ? { ...it, status: 'error' } : it,
          ),
        );
        setBusy(false);
        // Some files may still have been indexed on a partial server failure,
        // but we can't know which — signal a refetch so the list reconciles.
        return true;
      }
    },
    [busy, projectId, setStatusAt],
  );

  return { items, busy, uploadMany, reset };
}
