// Shared display formatting for the deliverables surface.

// ISO → "Jul 27 14:02" (mono updated column). Falls back to the raw string if
// unparseable so a bad timestamp never blanks the cell.
export function formatUpdated(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

// ISO → "Jul 27" (grid card, date-only).
export function formatUpdatedShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

// 0–1 progress → "62%" (processing meta). null → null (UI renders no %).
export function formatProgress(progress: number | null): string | null {
  if (progress == null) return null;
  return `${Math.round(progress * 100)}%`;
}
