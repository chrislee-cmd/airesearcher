// Length-based pricing: 2 credits per started 10 minutes (minimum 2).
// Examples: 5min=2, 10min=2, 11min=4, 60min=12, 120min=24.
const SECONDS_PER_UNIT = 600;
const CREDITS_PER_UNIT = 2;

export function computeVideoCredits(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return CREDITS_PER_UNIT;
  return Math.max(CREDITS_PER_UNIT, Math.ceil(durationSeconds / SECONDS_PER_UNIT) * CREDITS_PER_UNIT);
}
