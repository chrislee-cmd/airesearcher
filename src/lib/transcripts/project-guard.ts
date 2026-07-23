import type { SupabaseServer } from '@/lib/transcripts/dispatch';

// FK-guard for transcript_jobs.project_id (hotfix).
//
// transcript_jobs.project_id has an FK → public.projects(id), but the
// transcript widget's project-selection SSOT is `interview_projects`. A
// selected id that lives in interview_projects but not public.projects would
// violate the FK and crash the insert with
//   `violates foreign key constraint "transcript_jobs_project_id_fkey"`.
//
// This resolver checks whether the incoming project_id actually exists in
// public.projects (scoped to the active org). If it does, it's preserved; if
// not (or if null/undefined), it degrades to null so the transcript is created
// as "unfiled" rather than crashing. Root reconciliation of the two project
// namespaces is a separate follow-up ticket — this only stops the crash.
export async function resolveProjectId(
  supabase: SupabaseServer,
  projectId: string | null | undefined,
  orgId: string,
): Promise<string | null> {
  if (!projectId) return null;

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();

  return project ? projectId : null;
}
