// Length-based pricing: 1 credit per started 10 minutes (minimum 1).
// Examples: 5min=1, 10min=1, 11min=2, 60min=6, 120min=12.
const SECONDS_PER_CREDIT_UNIT = 600;

export function computeVideoCredits(durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return 1;
  return Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_CREDIT_UNIT));
}
