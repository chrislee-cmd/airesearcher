import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

const CreateBody = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  parent_folder_id: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ folders: [] });

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return NextResponse.json({ error: 'project_id_required' }, { status: 400 });

  const { data, error } = await supabase
    .from('folders')
    .select('id, project_id, parent_folder_id, name, created_at, updated_at')
    .eq('org_id', org.org_id)
    .eq('project_id', projectId)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ folders: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // Make sure project belongs to this org.
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', parsed.data.project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });

  // If parent_folder_id given, it must exist in the same project (the
  // schema only constrains org_id + parent FK, not parent.project_id).
  if (parsed.data.parent_folder_id) {
    const { data: parent } = await supabase
      .from('folders')
      .select('id, project_id')
      .eq('id', parsed.data.parent_folder_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!parent || parent.project_id !== parsed.data.project_id) {
      return NextResponse.json({ error: 'parent_not_in_project' }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('folders')
    .insert({
      org_id: org.org_id,
      project_id: parsed.data.project_id,
      parent_folder_id: parsed.data.parent_folder_id ?? null,
      name: parsed.data.name,
      created_by: user.id,
    })
    .select('id, project_id, parent_folder_id, name, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'db_error' }, { status: 400 });
  }
  return NextResponse.json(data);
}
