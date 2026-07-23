'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SchedMessage } from '@/lib/scheduling/messages';

// Loads + live-updates the recruiting-scheduling chat for one batch (admin
// scope: broadcast + every private thread in the batch). Mirrors the
// desk-job-provider realtime pattern — a `postgres_changes` subscription on
// sched_messages triggers a refetch, with a polling fallback so a dropped
// WebSocket still converges. The admin subscribes to ALL sched_messages
// events; PR4's participant hook will filter to broadcast + own-private.

const POLL_INTERVAL_MS = 15000;

export function useSchedMessages(batchId: string | null): {
  messages: SchedMessage[];
  loading: boolean;
  refetch: () => Promise<void>;
  editMessage: (id: string, body: string) => Promise<boolean>;
  deleteMessage: (id: string) => Promise<boolean>;
} {
  const [messages, setMessages] = useState<SchedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  // Guards against a slow response for an old batch overwriting a newer one.
  const reqIdRef = useRef(0);
  // Per-instance channel suffix. Multiple chat panels can now share the same
  // batch (수정4 멀티창) — a batch-only channel name would collide, and Supabase
  // rejects a second `.on('postgres_changes')` on an already-subscribed channel
  // ("cannot add postgres_changes callbacks ... after subscribe()"). useId gives
  // each hook instance a stable, unique topic. Colons stripped (topic-safe).
  const channelSuffix = useId().replace(/:/g, '');

  const refetch = useCallback(async () => {
    if (!batchId) return;
    const reqId = ++reqIdRef.current;
    try {
      const res = await fetch(
        `/api/scheduling/messages?batch=${encodeURIComponent(batchId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { messages?: SchedMessage[] };
      if (reqId !== reqIdRef.current) return; // a newer request superseded us
      setMessages(json.messages ?? []);
    } catch {
      // ignore — realtime or the next poll will catch up
    }
  }, [batchId]);

  // Edit a broadcast message's body (admin, round-3). Refetch on success so the
  // edit + "수정됨" marker land immediately even if the realtime event lags;
  // realtime will also fire for the other open panels. Returns success.
  const editMessage = useCallback(
    async (id: string, nextBody: string): Promise<boolean> => {
      const text = nextBody.trim();
      if (!text) return false;
      try {
        const res = await fetch(
          `/api/scheduling/messages/${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: text }),
          },
        );
        if (!res.ok) return false;
        await refetch();
        return true;
      } catch {
        return false;
      }
    },
    [refetch],
  );

  // Delete a broadcast message (admin, round-3). Refetch on success.
  const deleteMessage = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/scheduling/messages/${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) return false;
        await refetch();
        return true;
      } catch {
        return false;
      }
    },
    [refetch],
  );

  // Initial + on-batch-change load.
  useEffect(() => {
    if (!batchId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale thread on batch change
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [batchId, refetch]);

  // Realtime subscription — any sched_messages change → refetch this batch.
  useEffect(() => {
    if (!batchId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`sched-messages-${batchId}-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sched_messages' },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [batchId, refetch, channelSuffix]);

  // Polling fallback — covers a dropped/failed realtime channel.
  useEffect(() => {
    if (!batchId) return;
    const timer = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [batchId, refetch]);

  return { messages, loading, refetch, editMessage, deleteMessage };
}
