'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInterviewUploadSignal } from '@/components/interview-upload-provider';

// Interview V2 — client hook over
// /api/interviews/v2/projects/[id]/documents. Same plain-fetch shape as
// useInterviewV2Projects (no SWR dependency in this repo); exposes
// { documents, error, isLoading, mutate } so the project-detail file list
// can refetch after the (later-spec) upload flow adds files.

export type InterviewDocumentStatus =
  | 'pending'
  | 'indexing'
  | 'done'
  | 'error';

export type InterviewDocument = {
  id: string;
  filename: string;
  mime: string | null;
  char_count: number;
  // UTF-8 byte size of the stored text ("용량").
  byte_size: number;
  // Whitespace-split word count ("단어수").
  word_count: number;
  created_at: string;
  index_status: InterviewDocumentStatus;
  // Chunk-level indexing progress. total_chunks is null for documents
  // indexed before the progress feature (no backfill); processed_chunks
  // advances 0 → total as the indexer embeds each batch.
  total_chunks: number | null;
  processed_chunks: number;
};

export function useInterviewV2Documents(projectId: string | null) {
  const [documents, setDocuments] = useState<InterviewDocument[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!projectId) {
        setDocuments([]);
        setIsLoading(false);
        return;
      }
      // Polling refetches pass silent:true so the list doesn't flash its
      // loading skeleton every 2s while a file indexes.
      if (!opts?.silent) setIsLoading(true);
      try {
        const res = await fetch(
          `/api/interviews/v2/projects/${projectId}/documents`,
        );
        if (!res.ok) throw new Error(`list_failed_${res.status}`);
        const j = (await res.json()) as { documents?: InterviewDocument[] };
        setDocuments(j.documents ?? []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('list_failed'));
      } finally {
        if (!opts?.silent) setIsLoading(false);
      }
    },
    [projectId],
  );

  const mutate = useCallback(() => load(), [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void load();
  }, [load]);

  // Live progress — while any file is mid-indexing, silently refetch every
  // 2s so the per-file chunk progress bar advances. Keyed on the boolean so
  // the interval starts when indexing begins and clears once nothing is
  // 'indexing' (done / error / pending) — idle projects never poll.
  const hasIndexing = documents.some((d) => d.index_status === 'indexing');
  useEffect(() => {
    if (!projectId || !hasIndexing) return;
    const t = setInterval(() => void load({ silent: true }), 2000);
    return () => clearInterval(t);
  }, [projectId, hasIndexing, load]);

  // Background uploads now run in InterviewUploadProvider (outside this
  // component), so a batch adding NEW documents to this project wouldn't be
  // reflected here on its own. The provider bumps a per-project signal on every
  // batch transition + completion; refetch (silently) whenever it changes so
  // freshly-indexing rows appear and the hasIndexing poll above then takes over
  // the chunk-level progress. First render is skipped (initial load owns it).
  const uploadSignal = useInterviewUploadSignal(projectId);
  const prevSignalRef = useRef(uploadSignal);
  useEffect(() => {
    if (prevSignalRef.current === uploadSignal) return;
    prevSignalRef.current = uploadSignal;
    void load({ silent: true });
  }, [uploadSignal, load]);

  return { documents, error, isLoading, mutate };
}
