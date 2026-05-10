import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  item_count?: number;
};

// cache()d so layout + /projects page + /projects/[id] page share a single
// query within one SSR request.
export const listProjects = cache(async (orgId: string): Promise<Project[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('id, name, description, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (!data) return [];

  // Aggregate generations count per project
  const ids = data.map((p) => p.id);
  let counts = new Map<string, number>();
  if (ids.length) {
    const { data: gens } = await supabase
      .from('generations')
      .select('project_id')
      .in('project_id', ids);
    counts = new Map();
    for (const g of gens ?? []) {
      const k = g.project_id as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  return data.map((p) => ({ ...p, item_count: counts.get(p.id) ?? 0 }));
});

export type ProjectArtifact = {
  feature: 'report' | 'interview' | 'transcript' | 'desk' | 'scheduler' | 'recruiting' | 'generation';
  id: string;
  title: string;
  status: string | null;
  at: string;
};

// Pulls every artifact tied to a project across the seven backing
// stores. The dashboard counts come from getDashboardCards; this is
// the row-level expansion of one card.
export async function getProjectArtifacts(
  orgId: string,
  projectId: string,
): Promise<ProjectArtifact[]> {
  const supabase = await createClient();
  const [
    { data: reports },
    { data: interviews },
    { data: transcripts },
    { data: desk },
    { data: scheduler },
    { data: recruiting },
    { data: gens },
  ] = await Promise.all([
    supabase.from('report_jobs')
      .select('id, status, inputs, updated_at, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('interview_jobs')
      .select('id, status, inputs, updated_at, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('transcript_jobs')
      .select('id, status, filename, updated_at, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('desk_jobs')
      .select('id, status, keywords, updated_at, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('scheduler_sessions')
      .select('id, name, attendees, updated_at, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('recruiting_forms')
      .select('id, title, created_at')
      .eq('org_id', orgId).eq('project_id', projectId),
    supabase.from('generations')
      .select('id, feature, created_at')
      .eq('project_id', projectId),
  ]);

  const out: ProjectArtifact[] = [];
  for (const r of reports ?? []) {
    const inputs = (r.inputs as { filename?: string }[] | null) ?? [];
    out.push({
      feature: 'report',
      id: r.id as string,
      title: inputs[0]?.filename ?? `Report (${inputs.length} inputs)`,
      status: r.status as string | null,
      at: (r.updated_at ?? r.created_at) as string,
    });
  }
  for (const r of interviews ?? []) {
    const inputs = (r.inputs as { filename?: string }[] | null) ?? [];
    out.push({
      feature: 'interview',
      id: r.id as string,
      title: inputs[0]?.filename ?? `Interview (${inputs.length} inputs)`,
      status: r.status as string | null,
      at: (r.updated_at ?? r.created_at) as string,
    });
  }
  for (const r of transcripts ?? []) {
    out.push({
      feature: 'transcript',
      id: r.id as string,
      title: (r.filename as string | null) ?? 'Transcript',
      status: r.status as string | null,
      at: (r.updated_at ?? r.created_at) as string,
    });
  }
  for (const r of desk ?? []) {
    const kws = (r.keywords as string[] | null) ?? [];
    out.push({
      feature: 'desk',
      id: r.id as string,
      title: kws.length ? kws.join(', ') : 'Desk research',
      status: r.status as string | null,
      at: (r.updated_at ?? r.created_at) as string,
    });
  }
  for (const r of scheduler ?? []) {
    const attendees = (r.attendees as unknown[] | null) ?? [];
    out.push({
      feature: 'scheduler',
      id: r.id as string,
      title: (r.name as string | null) ?? `Scheduler (${attendees.length} attendees)`,
      status: null,
      at: (r.updated_at ?? r.created_at) as string,
    });
  }
  for (const r of recruiting ?? []) {
    out.push({
      feature: 'recruiting',
      id: r.id as string,
      title: (r.title as string | null) ?? 'Recruiting form',
      status: null,
      at: r.created_at as string,
    });
  }
  for (const r of gens ?? []) {
    out.push({
      feature: 'generation',
      id: r.id as string,
      title: r.feature as string,
      status: null,
      at: r.created_at as string,
    });
  }

  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out;
}
