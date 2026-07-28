import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { ASSIGN_TARGETS } from '@/lib/artifacts/registry';

// Feature → {table, idColumn, scopeColumn, projectTable} mapping now lives in
// the DeliverableAdapter registry (the narrow-waist SSOT). This route consumes
// it instead of a local copy — the nuances it used to encode inline
// (recruiting=form_id+user_id, transcript/desk FK to interview_projects to
// avoid a 23503 mirror-crash on a foreign public.projects id) are preserved
// verbatim there. Behaviour of this endpoint is unchanged; only the source of
// the mapping moved.
const FEATURES = ASSIGN_TARGETS;

const Body = z.object({
  feature: z.enum([
    'report',
    'interview',
    'transcript',
    'desk',
    'scheduler',
    'recruiting',
  ]),
  // recruiting form ids are Google API strings, not uuids
  id: z.string().min(1),
  // Optional now — caller can update either project assignment, folder
  // placement, or both. Undefined = leave that column unchanged.
  project_id: z.string().uuid().nullable().optional(),
  folder_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ error: 'no_org' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { feature, id, project_id, folder_id } = parsed.data;
  const target = FEATURES[feature];

  if (project_id === undefined && folder_id === undefined) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  if (project_id) {
    // Validate against the FK target for THIS feature's table (projects vs
    // interview_projects) so a foreign-namespace id is rejected here rather
    // than mirror-crashing the update. Both tables are org-scoped.
    const { data: project } = await supabase
      .from(target.projectTable)
      .select('id')
      .eq('id', project_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  if (folder_id) {
    // Folder must belong to the same org. If project_id is also being set
    // in this same call, folder must live in that project; otherwise we
    // accept any folder in-org and trust the caller (UI flow assigns
    // folders within the artifact's current project).
    const { data: folder } = await supabase
      .from('folders')
      .select('id, project_id')
      .eq('id', folder_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: 'folder_not_found' }, { status: 404 });
    if (project_id && folder.project_id !== project_id) {
      return NextResponse.json({ error: 'folder_project_mismatch' }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (project_id !== undefined) patch.project_id = project_id;
  if (folder_id !== undefined) patch.folder_id = folder_id;
  // If the artifact moves to a different project (or to no project), it
  // can't sit in a folder anymore — folder_id implicitly clears.
  if (project_id !== undefined && folder_id === undefined) patch.folder_id = null;

  const scopeValue = target.scopeColumn === 'org_id' ? org.org_id : user.id;
  const { error } = await supabase
    .from(target.table)
    .update(patch)
    .eq(target.idColumn, id)
    .eq(target.scopeColumn, scopeValue);

  if (error) {
    console.error('[artifacts/assign] update error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
