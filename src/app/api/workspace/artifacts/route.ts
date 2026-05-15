import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  listWorkspaceArtifacts,
  type ProjectFilter,
} from '@/lib/workspace-server';

// GET /api/workspace/artifacts?project=<id|unfiled|all>[&folder=<id|root>]
// Default: 'all' — every artifact in the org.
//   - <uuid>: artifacts assigned to that project
//   - 'unfiled': artifacts with project_id = null
//   - 'all': every artifact regardless of project_id
// Optional `folder` narrows within a project:
//   - <uuid>: artifacts in that folder
//   - 'root': artifacts in the project with folder_id IS NULL
// folder is ignored unless project is a uuid.

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ artifacts: [] });

  const url = new URL(req.url);
  const raw = url.searchParams.get('project');
  const folderRaw = url.searchParams.get('folder');
  let filter: ProjectFilter;
  if (!raw || raw === 'all') {
    filter = { kind: 'all' };
  } else if (raw === 'unfiled') {
    filter = { kind: 'unfiled' };
  } else if (folderRaw) {
    filter = {
      kind: 'folder',
      projectId: raw,
      folderId: folderRaw === 'root' ? null : folderRaw,
    };
  } else {
    filter = { kind: 'project', projectId: raw };
  }

  const artifacts = await listWorkspaceArtifacts(org.org_id, filter);
  return NextResponse.json({ artifacts });
}
