// Shared types + pure helpers for the recruiting-scheduling chat (PR3).
// Framework-free so the admin API routes and the client panel import one place.
//
// Two message scopes, disambiguated by candidate_id (enforced by a DB CHECK):
//   * broadcast — candidate_id null, announcement to all participants
//   * private   — candidate_id set, 1:1 thread with one candidate
// sender_role is admin|participant; PR3 only ever creates admin rows (participant
// send is PR4).

export const MESSAGE_SCOPES = ['broadcast', 'private'] as const;
export type MessageScope = (typeof MESSAGE_SCOPES)[number];

export const MESSAGE_SENDER_ROLES = ['admin', 'participant'] as const;
export type MessageSenderRole = (typeof MESSAGE_SENDER_ROLES)[number];

export type SchedMessage = {
  id: string;
  candidate_id: string | null; // null = broadcast
  scope: MessageScope;
  sender_role: MessageSenderRole;
  sender_user_id: string | null;
  body: string;
  created_at: string; // ISO / timestamptz (UTC)
};

// The exact column list every read/write selects — keeps API + realtime refetch
// in sync with the table shape.
export const SCHED_MESSAGE_COLUMNS =
  'id, candidate_id, scope, sender_role, sender_user_id, body, created_at';

export function isMessageScope(v: unknown): v is MessageScope {
  return (
    typeof v === 'string' && (MESSAGE_SCOPES as readonly string[]).includes(v)
  );
}

// The broadcast thread's synthetic id used by the client's thread list — a
// candidate id is never this value (candidate ids are uuids), so it's a safe
// sentinel for "the broadcast thread is selected".
export const BROADCAST_THREAD_ID = '__broadcast__';

// Longest message we accept — a coordination note, not an essay. Mirrors the
// API-side guard so the composer can disable Send past the limit.
export const MAX_MESSAGE_LENGTH = 4000;

// Split a flat message list into the broadcast thread + a per-candidate map,
// each ordered oldest→newest. Used by the admin panel to render threads.
export function groupMessages(messages: SchedMessage[]): {
  broadcast: SchedMessage[];
  byCandidate: Map<string, SchedMessage[]>;
} {
  const sorted = [...messages].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const broadcast: SchedMessage[] = [];
  const byCandidate = new Map<string, SchedMessage[]>();
  for (const m of sorted) {
    if (m.scope === 'broadcast' || m.candidate_id == null) {
      broadcast.push(m);
    } else {
      const list = byCandidate.get(m.candidate_id) ?? [];
      list.push(m);
      byCandidate.set(m.candidate_id, list);
    }
  }
  return { broadcast, byCandidate };
}
