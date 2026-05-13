import type { SupabaseClient } from '@supabase/supabase-js';

// Credit cost for one enhancement pass. Less than full reports (50) since
// we're reusing the base markdown; charge enough to cover the LLM call
// for enhance + re-render.
export const REPORT_ENHANCE_COST = 20;

export type ReportEnhancementKind = 'trends' | 'logs' | 'perspective';

export type ReportVersionRow = {
  id: string;
  report_id: string;
  version: number;
  parent_version: number | null;
  enhancement: ReportEnhancementKind | null;
  markdown: string;
  html: string;
  context_payload: unknown;
  credits_spent: number;
  created_at: string;
  created_by: string | null;
};

// Returns the next free version number for a report (max(version) + 1,
// or 0 if none yet).
export async function nextVersionNumber(
  supabase: SupabaseClient,
  reportId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('report_versions')
    .select('version')
    .eq('report_id', reportId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.version as number) + 1 : 0;
}

export async function getVersion(
  supabase: SupabaseClient,
  reportId: string,
  version: number,
): Promise<ReportVersionRow | null> {
  const { data, error } = await supabase
    .from('report_versions')
    .select('*')
    .eq('report_id', reportId)
    .eq('version', version)
    .maybeSingle();
  if (error) throw error;
  return (data as ReportVersionRow | null) ?? null;
}

export async function listVersions(
  supabase: SupabaseClient,
  reportId: string,
): Promise<ReportVersionRow[]> {
  const { data, error } = await supabase
    .from('report_versions')
    .select('*')
    .eq('report_id', reportId)
    .order('version', { ascending: true });
  if (error) throw error;
  return (data as ReportVersionRow[] | null) ?? [];
}
