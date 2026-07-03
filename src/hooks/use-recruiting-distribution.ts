'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DistributionTable } from '@/lib/recruiting/distribution';

// Client hook over GET /api/recruiting/google/forms/[formId]/distribution.
// Plain-fetch shape (no SWR dependency in this repo — mirrors the interview-v2
// hooks). Returns { table, error, isLoading, mutate }:
//   - table === undefined  → not loaded yet (or no form selected)
//   - table === null       → form has no 성별/연령 column to cross-tab
//   - table.grandTotal 0   → columns exist but no responses yet
//
// xField / yField are optional questionId overrides for the gender / age
// axis; omitted on the basic fullview so the server auto-detects by title.
export function useRecruitingDistribution(
  formId: string | null,
  xField?: string,
  yField?: string,
) {
  const [table, setTable] = useState<DistributionTable | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutate = useCallback(async () => {
    if (!formId) {
      setTable(undefined);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (xField) qs.set('x', xField);
      if (yField) qs.set('y', yField);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(
        `/api/recruiting/google/forms/${encodeURIComponent(formId)}/distribution${suffix}`,
      );
      const j = (await res.json().catch(() => ({}))) as {
        table?: DistributionTable | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(j.error || `distribution_failed_${res.status}`);
      }
      setTable(j.table ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('distribution_failed'));
      setTable(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [formId, xField, yField]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async fetch result
    void mutate();
  }, [mutate]);

  return { table, error, isLoading, mutate };
}
