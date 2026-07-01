import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AdminUsageReport } from './types';

// Per-provider cumulative USD captured at baseline time. Only providers
// that expose a numeric USD cost appear here — a missing key means "no
// baseline for that row" and the UI shows the raw cumulative instead.
export type SnapshotProviders = Record<string, { cumulative_usd: number }>;

export type UsageSnapshot = {
  id: string;
  taken_at: string;
  taken_by_email: string;
  providers: SnapshotProviders;
  baseline_for: string;
  note: string | null;
};

const COLUMNS = 'id, taken_at, taken_by_email, providers, baseline_for, note';

// Snapshot the cumulative USD figure each provider currently reports.
// Providers without a USD cost (character-quota-only, revenue-only, etc.)
// are omitted so they don't render a bogus $0 baseline.
export function extractCumulative(report: AdminUsageReport): SnapshotProviders {
  const out: SnapshotProviders = {};
  for (const p of report.providers) {
    if (typeof p.costUsd === 'number') {
      out[p.id] = { cumulative_usd: p.costUsd };
    }
  }
  return out;
}

// Persist the current cumulative values as the new baseline. Uses the
// service-role client because the table is RLS-locked to service_role
// only (see migration) — the caller MUST have passed the super-admin
// gate before reaching here.
export async function saveSnapshot(opts: {
  report: AdminUsageReport;
  email: string;
  note?: string | null;
}): Promise<UsageSnapshot> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('admin_usage_snapshots')
    .insert({
      taken_by_email: opts.email,
      providers: extractCumulative(opts.report),
      note: opts.note ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as UsageSnapshot;
}

// Most recent baseline = current baseline. Returns null when no snapshot
// has ever been taken (first-run "baseline 없음" state).
export async function getLatestSnapshot(): Promise<UsageSnapshot | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('admin_usage_snapshots')
    .select(COLUMNS)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UsageSnapshot | null) ?? null;
}
