import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { listFolders } from '@/lib/workspace-server';

// GET /api/workspace/folders?project=<uuid>
// Flat list of folders in a project. Tree is built client-side.

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ folders: [] });

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project');
  if (!projectId) return NextResponse.json({ folders: [] });

  const folders = await listFolders(org.org_id, projectId);
  return NextResponse.json({ folders });
}
