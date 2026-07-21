'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SchedMessage } from '@/lib/scheduling/messages';
import type { SchedSlot } from '@/lib/scheduling/slots';

// Loads + live-updates the participant's own schedule + chat (PR4). Unlike the
// admin's useSchedMessages, this runs on the ANON participant page, so it does
// NOT open a `postgres_changes` subscription: Realtime respects RLS, and the
// only way to deliver changes to the (public) anon key would be an anon SELECT
// policy on sched_messages/sched_slots — which would leak every candidate's
// data. Instead we short-poll the token-scoped endpoint, which already enforces
// the per-candidate scope server-side. `refetch` after a send makes the
// participant see their own message immediately between polls.

const POLL_INTERVAL_MS = 7000;

export type SchedPublicData = {
  slots: SchedSlot[];
  messages: SchedMessage[];
};

export function useSchedPublic(token: string): {
  slots: SchedSlot[];
  messages: SchedMessage[];
  loading: boolean;
  error: boolean;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<SchedPublicData>({ slots: [], messages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reqIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    try {
      const res = await fetch(
        `/api/scheduling/public/${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        if (reqId === reqIdRef.current) setError(true);
        return;
      }
      const json = (await res.json()) as Partial<SchedPublicData>;
      if (reqId !== reqIdRef.current) return; // a newer request superseded us
      setError(false);
      setData({ slots: json.slots ?? [], messages: json.messages ?? [] });
    } catch {
      if (reqId === reqIdRef.current) setError(true);
    }
  }, [token]);

  // Initial load. `loading` starts true (useState(true)), so we only need to
  // clear it once the first fetch settles — no synchronous setState in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; every setState fires after the async fetch settles, not synchronously
    void refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  // Polling — the participant's live-update channel (no anon realtime).
  useEffect(() => {
    const timer = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refetch]);

  return {
    slots: data.slots,
    messages: data.messages,
    loading,
    error,
    refetch,
  };
}
