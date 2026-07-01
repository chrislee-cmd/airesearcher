'use client';

// useTranslateListeners — host-side view of who is currently listening
// to a live-interpretation share link.
//
// Each viewer (/live/<token>) calls `channel.track({...})` on the shared
// Supabase Realtime channel `live:<sessionId>`. We subscribe to the same
// topic's presence state and derive the current listener list. No DB, no
// heartbeat, no cleanup job — when a viewer's tab closes, Supabase drops
// its presence entry and the host list updates within ~1s.
//
// This subscription is intentionally separate from the host's broadcast
// channel (which only sends caption deltas and is created mid-start). A
// dedicated presence-only channel keeps the listener wiring isolated from
// the audio/caption lifecycle, so it can't regress the live session.

import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';

// Payload a viewer tracks. Kept small + privacy-light: an opaque anon id,
// when they joined, and a raw UA string we parse client-side for display.
export type ListenerPresence = {
  anon_id: string;
  joined_at: string; // ISO 8601
  user_agent: string;
};

export type Listener = ListenerPresence & {
  // Supabase presence ref — unique per tracked connection. Used as the
  // React key so two tabs from the same browser (same anon_id) don't
  // collide.
  key: string;
};

// Pure mapping from a channel's presence state to the host listener list.
// Extracted so the host can derive listeners from a channel it ALREADY
// owns (its broadcast channel) instead of opening a second channel on the
// same topic — supabase-js dedupes channels by topic, and calling `.on()`
// on an already-subscribed channel throws
// ("cannot add presence callbacks ... after subscribe()"). That collision
// crashed the 동시통역 fullview once the card console kept its broadcast
// channel alive. See translate-console's presence wiring.
export function listenersFromPresence(
  state: Record<string, ListenerPresence[]>,
): Listener[] {
  const next: Listener[] = [];
  for (const [presenceKey, entries] of Object.entries(state)) {
    for (const entry of entries) {
      // Defensive: only count entries that actually carry our viewer
      // payload (anon_id). The host's own presence — if any — and
      // malformed entries are skipped.
      if (!entry || typeof entry.anon_id !== 'string') continue;
      next.push({
        key: `${presenceKey}:${entry.anon_id}`,
        anon_id: entry.anon_id,
        joined_at: entry.joined_at ?? '',
        user_agent: entry.user_agent ?? '',
      });
    }
  }
  // Stable order: earliest joiner first.
  next.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return next;
}

// Standalone presence subscriber for contexts that do NOT already hold a
// channel on the `live:<sessionId>` topic. NOTE: do not use this when the
// same Supabase client already has a subscribed channel for that topic
// (e.g. the host's caption broadcast channel) — derive listeners from that
// channel via listenersFromPresence() instead, or supabase-js throws on the
// duplicate `.on()`.
export function useTranslateListeners(sessionId: string | null): Listener[] {
  const [listeners, setListeners] = useState<Listener[]>([]);

  useEffect(() => {
    if (!sessionId) return;

    const supa = createBrowserSupabase();
    const channel: RealtimeChannel = supa.channel(`live:${sessionId}`, {
      // A distinct presence key so the host (which never tracks itself)
      // is unambiguously separate from any viewer entry.
      config: { presence: { key: 'host' } },
    });

    const sync = () => {
      setListeners(listenersFromPresence(channel.presenceState<ListenerPresence>()));
    };

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe();

    return () => {
      try {
        void channel.unsubscribe();
      } catch {
        // ignore — teardown best-effort
      }
      // Clear on teardown (session ended or id changed) so a stale list
      // never lingers. Safe here — runs in cleanup, not the effect body.
      setListeners([]);
    };
  }, [sessionId]);

  return listeners;
}
