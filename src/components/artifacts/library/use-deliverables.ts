'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DeliverableFeature,
  DeliverableListResponse,
  DeliverableRow,
  DeliverableStatus,
} from '@/lib/artifacts/types';

export type DeliverableFilters = {
  feature: DeliverableFeature | null;
  status: DeliverableStatus | null;
  projectId: string | null;
  q: string;
};

type Facets = DeliverableListResponse['facets'];

type State = {
  rows: DeliverableRow[];
  facets: Facets;
  nextCursor: string | null;
  loading: boolean; // initial / filter-change load
  loadingMore: boolean; // appending a page
  error: boolean;
};

const EMPTY_FACETS: Facets = { by_feature: {}, by_status: {} };
const PAGE_LIMIT = 50;
const DEBOUNCE_MS = 250;

function buildQuery(f: DeliverableFilters, cursor: string | null): string {
  const sp = new URLSearchParams();
  if (f.feature) sp.set('feature', f.feature);
  if (f.status) sp.set('status', f.status);
  if (f.projectId) sp.set('project_id', f.projectId);
  if (f.q.trim()) sp.set('q', f.q.trim());
  if (cursor) sp.set('cursor', cursor);
  sp.set('limit', String(PAGE_LIMIT));
  return sp.toString();
}

// Consumes GET /api/artifacts. Resets to page 1 on any filter change (q
// debounced), and appends via the cursor. facets come straight from the server
// (faceted-search semantics) and back the rail counts.
export function useDeliverables(filters: DeliverableFilters) {
  const [state, setState] = useState<State>({
    rows: [],
    facets: EMPTY_FACETS,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: false,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [debouncedQ, setDebouncedQ] = useState(filters.q);

  // Debounce the search term so keystrokes don't fire a request each.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(filters.q), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [filters.q]);

  const effective: DeliverableFilters = { ...filters, q: debouncedQ };
  const key = `${effective.feature ?? ''}|${effective.status ?? ''}|${effective.projectId ?? ''}|${effective.q.trim()}|${reloadKey}`;

  // A monotonically increasing token guards against out-of-order responses
  // (a slow page-1 landing after a newer filter's page-1).
  const reqToken = useRef(0);

  // Page 1 (reset) on filter/reload change.
  useEffect(() => {
    const token = ++reqToken.current;
    // Flag the loading state before the async fetch begins. This is the
    // canonical data-fetch-on-filter-change pattern; the follow-up updates
    // land in the async .then, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an imperative fetch, not derivable state
    setState((s) => ({ ...s, loading: true, error: false }));
    fetch(`/api/artifacts?${buildQuery(effective, null)}`)
      .then((r) => (r.ok ? (r.json() as Promise<DeliverableListResponse>) : Promise.reject()))
      .then((data) => {
        if (token !== reqToken.current) return;
        setState({
          rows: data.rows,
          facets: data.facets ?? EMPTY_FACETS,
          nextCursor: data.next_cursor,
          loading: false,
          loadingMore: false,
          error: false,
        });
      })
      .catch(() => {
        if (token !== reqToken.current) return;
        setState({
          rows: [],
          facets: EMPTY_FACETS,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: true,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every filter input
  }, [key]);

  const loadMore = useCallback(() => {
    setState((s) => {
      if (s.loadingMore || !s.nextCursor || s.loading) return s;
      const token = reqToken.current; // stay bound to the current filter set
      const cursor = s.nextCursor;
      fetch(`/api/artifacts?${buildQuery(effective, cursor)}`)
        .then((r) => (r.ok ? (r.json() as Promise<DeliverableListResponse>) : Promise.reject()))
        .then((data) => {
          if (token !== reqToken.current) return; // filters changed mid-flight
          setState((cur) => ({
            ...cur,
            rows: [...cur.rows, ...data.rows],
            nextCursor: data.next_cursor,
            loadingMore: false,
          }));
        })
        .catch(() => {
          if (token !== reqToken.current) return;
          setState((cur) => ({ ...cur, loadingMore: false }));
        });
      return { ...s, loadingMore: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effective is derived; token binds correctness
  }, [debouncedQ, filters.feature, filters.status, filters.projectId]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    rows: state.rows,
    facets: state.facets,
    nextCursor: state.nextCursor,
    hasMore: state.nextCursor != null,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMore,
    reload,
  };
}
