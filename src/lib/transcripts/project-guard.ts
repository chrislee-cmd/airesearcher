import type { SupabaseServer } from '@/lib/transcripts/dispatch';

// FK-guard for transcript_jobs.project_id.
//
// transcript_jobs.project_id has an FK → public.interview_projects(id) (see
// migration 20260723150349_transcript_jobs_project_fk_to_v2.sql). The transcript
// widget's project-selection SSOT is `interview_projects`, so the FK target and
// the selection source now agree — a selected project id validates and the
// transcript is attributed to that project ("귀속 복원").
//
// This resolver checks whether the incoming project_id actually exists in
// interview_projects (scoped to the active org). If it does, it's preserved; if
// not (or if null/undefined) — e.g. a stale/legacy public.projects fallback id —
// it degrades to null so the transcript is created as "unfiled" rather than
// mirror-crashing against the new FK. This preserves the 544 crash-safe contract
// while the FK reconciliation restores attribution for valid selections.
export async function resolveProjectId(
  supabase: SupabaseServer,
  projectId: string | null | undefined,
  orgId: string,
): Promise<string | null> {
  if (!projectId) return null;

  const { data: project } = await supabase
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();

  return project ? projectId : null;
}
