// Shared types + pure helpers for the recruiting-scheduling chat (PR3).
// Framework-free so the admin API routes and the client panel import one place.
//
// Two message scopes, disambiguated by candidate_id (enforced by a DB CHECK):
//   * broadcast — candidate_id null, sent to many participants
//   * private   — candidate_id set, 1:1 thread with one candidate
// sender_role is admin|participant; PR3 only ever creates admin rows (participant
// send is PR4).
//
// Broadcast messages carry two extra axes (additive migration
// 20260722150000_sched_messages_broadcast_modes):
//   * is_announcement — true=공지 (renders as a banner), false=발송 (chat bubble)
//   * batch_id        — null=전체 (all participants), set=그룹별 (that batch only)
// The four broadcast modes are the (is_announcement × batch_id) combinations.

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
  // Broadcast axes (see file header). Private messages carry is_announcement=true
  // / batch_id=null but never use them. Optional in the type so a narrow read on
  // a preview DB that predates the migration still satisfies it.
  is_announcement: boolean;
  batch_id: string | null;
  // Set by the [id] PATCH route when a message is edited (round-3); null on a row
  // that was never edited or read from a preview DB predating the additive column.
  // The "수정됨" marker shows only when this is present and later than created_at.
  updated_at: string | null;
};

// The wide column list — includes the broadcast-mode columns. Reads that select
// this MUST pair it with a narrow fallback (SCHED_MESSAGE_COLUMNS_NARROW +
// widenNarrowMessage) so a preview DB without the additive columns still serves.
export const SCHED_MESSAGE_COLUMNS =
  'id, candidate_id, scope, sender_role, sender_user_id, body, created_at, is_announcement, batch_id, updated_at';

// Pre-broadcast-modes column set, used as the fallback when the wide select
// errors on a DB that predates the migration.
export const SCHED_MESSAGE_COLUMNS_NARROW =
  'id, candidate_id, scope, sender_role, sender_user_id, body, created_at';

// Widen a narrow row to the full shape. Every pre-migration broadcast was a
// global announcement, so default is_announcement=true (banner) + batch_id=null
// (everyone) — this is exactly what preserves the legacy "전체 공지" rendering.
export function widenNarrowMessage(row: Record<string, unknown>): SchedMessage {
  return {
    ...(row as Omit<
      SchedMessage,
      'is_announcement' | 'batch_id' | 'updated_at'
    >),
    is_announcement: true,
    batch_id: null,
    updated_at: null,
  };
}

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
