import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  listWorkspaceArtifacts,
  type ProjectFilter,
} from '@/lib/workspace-server';

// GET /api/workspace/artifacts?project=<id|unfiled|all>
// Default: 'all' — every artifact in the org.
//   - <uuid>: artifacts assigned to that project
//   - 'unfiled': artifacts with project_id = null
//   - 'all': every artifact regardless of project_id
//
// Returns metadata only (no content). Use /api/workspace/content for the
// actual text/markdown/html of a single artifact.

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ artifacts: [] });

  const url = new URL(req.url);
  const raw = url.searchParams.get('project');
  let filter: ProjectFilter;
  if (!raw || raw === 'all') {
    filter = { kind: 'all' };
  } else if (raw === 'unfiled') {
    filter = { kind: 'unfiled' };
  } else {
    filter = { kind: 'project', projectId: raw };
  }

  const artifacts = await listWorkspaceArtifacts(org.org_id, filter);
  return NextResponse.json({ artifacts });
}
