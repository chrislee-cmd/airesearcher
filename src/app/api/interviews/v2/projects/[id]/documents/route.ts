import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — files belonging to one interview_project.
//
// Backs the file list in the V2 project-detail view. interview_documents
// has no per-row status column; the indexing state lives on the parent
// interview_jobs.index_status (pending / indexing / done / error). We embed
// it via the direct FK interview_documents.interview_job_id → interview_jobs.id
// so each file row can render an in-flight / done / error pill.
//
// Scope: org_id (matching the has_org_role RLS on interview_documents) +
// project_id. Documents are only attached to a project by the upload flow
// shipped in a later spec, so this list is expected to be empty for now.

type DocRow = {
  id: string;
  filename: string;
  mime: string | null;
  char_count: number;
  created_at: string;
  interview_jobs: { index_status: string | null } | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ documents: [] });
  }

  const { data, error } = await supabase
    .from('interview_documents')
    .select(
      'id, filename, mime, char_count, created_at, interview_jobs(index_status)',
    )
    .eq('org_id', org.org_id)
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[interviews/v2/projects/:id/documents] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }

  const documents = ((data ?? []) as unknown as DocRow[]).map((d) => ({
    id: d.id,
    filename: d.filename,
    mime: d.mime,
    char_count: d.char_count,
    created_at: d.created_at,
    index_status: d.interview_jobs?.index_status ?? 'pending',
  }));

  return NextResponse.json({ documents });
}
