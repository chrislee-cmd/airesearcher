// Length-based pricing: 3 credits per started 10 minutes (minimum 3).
// Examples: 5min=3, 10min=3, 11min=6, 60min=18, 120min=36.
const SECONDS_PER_UNIT = 600;
const CREDITS_PER_UNIT = 3;

export function computeVideoCredits(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return CREDITS_PER_UNIT;
  return Math.max(CREDITS_PER_UNIT, Math.ceil(durationSeconds / SECONDS_PER_UNIT) * CREDITS_PER_UNIT);
}
