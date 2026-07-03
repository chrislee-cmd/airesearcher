'use client';

import { useCallback, useEffect, useState } from 'react';

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
  // Document's first / last question (null when not Q&A shaped).
  first_question: string | null;
  last_question: string | null;
  created_at: string;
  index_status: InterviewDocumentStatus;
};

export function useInterviewV2Documents(projectId: string | null) {
  const [documents, setDocuments] = useState<InterviewDocument[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mutate = useCallback(async () => {
    if (!projectId) {
      setDocuments([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void mutate();
  }, [mutate]);

  return { documents, error, isLoading, mutate };
}
