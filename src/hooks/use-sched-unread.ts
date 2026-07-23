'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BROADCAST_THREAD_ID, type SchedMessage } from '@/lib/scheduling/messages';

// Admin-side unread badge state for the recruiting-scheduling chat. A participant
// message in a thread (private candidate thread or the broadcast thread) counts
// as unread until the admin has "seen" that thread. Last-seen is stored PER
// THREAD in localStorage (MVP — no server read-state), namespaced by project so a
// project switch never bleeds seen state.
//
// This runs at the PARENT (recruiting-scheduling-client) so a badge can show on a
// thread entry point (confirmed-roster row CTA · broadcast CTA) even when no chat
// tile is open. It fetches the same /api/scheduling/messages endpoint the panel
// uses (server unchanged), unioning every batch's messages, and mirrors the
// panel's realtime + poll convergence so a new participant message lights the
// badge live. Only the latest participant timestamp per thread is retained.

const POLL_INTERVAL_MS = 30000;
const STORAGE_KEY = 'recsched:chat-seen:v1';

// threadKey → epoch ms the admin last saw that thread.
type SeenMap = Record<string, number>;

function loadSeen(): SeenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as SeenMap)
      : {};
  } catch {
    return {};
  }
}

// Namespace seen-state by project so switching projects doesn't cross-clear.
function seenKey(projectId: string, threadId: string): string {
  return `${projectId}::${threadId}`;
}

// The thread a message belongs to: broadcast (candidate_id null) or the candidate.
function threadOf(m: SchedMessage): string {
  return m.candidate_id == null ? BROADCAST_THREAD_ID : m.candidate_id;
}

export function useSchedUnread(
  projectId: string | null,
  batchIds: string[],
): {
  // True when a participant message in this thread is newer than the admin's
  // last-seen mark for it.
  isUnread: (threadId: string) => boolean;
  // Record the current time as "seen" for this thread → clears its badge.
  markSeen: (threadId: string) => void;
  // Latest participant-message time per thread (epoch ms). Exposed so the parent
  // can keep an OPEN tile's thread marked seen as new messages arrive.
  latestParticipantAt: Map<string, number>;
} {
  // Stable identity for the batch set so effects don't re-fire on a new array ref.
  const batchKey = useMemo(() => [...batchIds].sort().join(','), [batchIds]);
  const ids = useMemo(() => (batchKey ? batchKey.split(',') : []), [batchKey]);

  const [latest, setLatest] = useState<Map<string, number>>(new Map());
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen());
  // Guards against a slow response overwriting a newer one.
  const reqIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (ids.length === 0) return;
    const reqId = ++reqIdRef.current;
    try {
      const results = await Promise.all(
        ids.map((b) =>
          fetch(
            `/api/scheduling/messages?batch=${encodeURIComponent(b)}`,
            { cache: 'no-store' },
          )
            .then((r) => (r.ok ? (r.json() as Promise<{ messages?: SchedMessage[] }>) : null))
            .catch(() => null),
        ),
      );
      if (reqId !== reqIdRef.current) return; // a newer request superseded us
      const map = new Map<string, number>();
      for (const json of results) {
        for (const m of json?.messages ?? []) {
          if (m.sender_role !== 'participant') continue;
          const key = threadOf(m);
          const at = new Date(m.created_at).getTime();
          if (at > (map.get(key) ?? 0)) map.set(key, at);
        }
      }
      setLatest(map);
    } catch {
      // ignore — realtime or the next poll will catch up
    }
  }, [ids]);

  // Initial + on-scope-change load. Clear synchronously when the scope empties
  // (project with no batches) so a stale badge set doesn't linger.
  useEffect(() => {
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear on empty scope
      setLatest(new Map());
      return;
    }
    void refetch();
  }, [ids, refetch]);

  // Realtime — any sched_messages change → refetch. One channel for the parent.
  useEffect(() => {
    if (ids.length === 0) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`sched-unread-${batchKey}`)
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
  }, [ids, batchKey, refetch]);

  // Polling fallback — covers a dropped/failed realtime channel.
  useEffect(() => {
    if (ids.length === 0) return;
    const timer = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ids, refetch]);

  const markSeen = useCallback(
    (threadId: string) => {
      if (!projectId) return;
      const key = seenKey(projectId, threadId);
      setSeen((prev) => {
        // Date.now() lives in an event/effect callback (not render), so it's
        // outside react-hooks/purity's scope.
        const next = { ...prev, [key]: Date.now() };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // localStorage unavailable (private mode / quota) — badge just won't
          // persist across reloads; in-session state still clears.
        }
        return next;
      });
    },
    [projectId],
  );

  const isUnread = useCallback(
    (threadId: string): boolean => {
      if (!projectId) return false;
      const at = latest.get(threadId);
      if (!at) return false;
      return at > (seen[seenKey(projectId, threadId)] ?? 0);
    },
    [projectId, latest, seen],
  );

  return { isUnread, markSeen, latestParticipantAt: latest };
}
