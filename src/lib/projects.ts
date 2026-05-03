import { createClient } from '@/lib/supabase/server';

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  item_count?: number;
};

export async function listProjects(orgId: string): Promise<Project[]> {
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
}
