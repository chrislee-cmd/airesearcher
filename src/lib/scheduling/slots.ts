// Shared types + pure helpers for the recruiting-scheduling slot calendar
// (PR2). Kept framework-free so both the admin API routes and the client
// components import from one place.

export const SLOT_STATUSES = ['proposed', 'confirmed', 'cancelled'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export type SchedSlot = {
  id: string;
  // Null for a standalone titled event with no candidate attached (PR-B).
  candidate_id: string | null;
  // Direct batch scope so candidate-less events still belong to a batch (PR-B).
  // May be null on rows created before the migration / on preview DBs.
  batch_id: string | null;
  // Free-text event label (PR-B). Blank → fall back to the candidate name.
  title: string | null;
  start_at: string; // ISO / timestamptz (UTC)
  end_at: string;
  status: SlotStatus;
  location: string | null;
  note: string | null;
};

export function isSlotStatus(v: unknown): v is SlotStatus {
  return typeof v === 'string' && (SLOT_STATUSES as readonly string[]).includes(v);
}

// Two slots overlap when one starts before the other ends (both directions).
// Cancelled slots never contribute to a double-booking warning.
export function slotsOverlap(
  a: { start_at: string; end_at: string; status: SlotStatus },
  b: { start_at: string; end_at: string; status: SlotStatus },
): boolean {
  if (a.status === 'cancelled' || b.status === 'cancelled') return false;
  const aStart = new Date(a.start_at).getTime();
  const aEnd = new Date(a.end_at).getTime();
  const bStart = new Date(b.start_at).getTime();
  const bEnd = new Date(b.end_at).getTime();
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return false;
  return aStart < bEnd && bStart < aEnd;
}

// The soft double-booking warning: any other non-cancelled slot whose time
// overlaps `candidate`. `excludeId` skips the slot being edited itself.
export function findOverlaps(
  candidate: { start_at: string; end_at: string; status: SlotStatus },
  all: SchedSlot[],
  excludeId?: string,
): SchedSlot[] {
  return all.filter(
    (s) => s.id !== excludeId && slotsOverlap(candidate, s),
  );
}

// --- Local-timezone formatting (browser-rendered; slots are stored UTC) ---

// Pad to 2 digits for datetime-local strings.
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ISO (UTC) → "YYYY-MM-DDTHH:mm" in the browser's local timezone, the value
// shape <input type="datetime-local"> expects.
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

// "YYYY-MM-DDTHH:mm" (local) → ISO (UTC). new Date(localString) parses in the
// local timezone, so toISOString() yields the correct UTC instant.
export function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// The slot a candidate row surfaces in the list "다음 슬롯" column: the
// earliest upcoming non-cancelled slot; if none upcoming, the most recent
// non-cancelled past slot; null if the candidate has only cancelled/no slots.
export function nextSlotForCandidate(
  candidateId: string,
  all: SchedSlot[],
  now: number,
): SchedSlot | null {
  const active = all
    .filter((s) => s.candidate_id === candidateId && s.status !== 'cancelled')
    .sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
  if (active.length === 0) return null;
  const upcoming = active.find((s) => new Date(s.start_at).getTime() >= now);
  return upcoming ?? active[active.length - 1];
}
