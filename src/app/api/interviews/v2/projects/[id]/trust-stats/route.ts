import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — trust panel stats for one interview_project.
//
// Backs the collapsible 신뢰도 (trust) panel under the file list (option B
// detailed panel + option A). Reports three numbers the UI turns into a
// reassurance summary:
//   fileCount   — interview_documents attached to the project
//   chunkCount  — interview_chunks embedded from those documents
//   embedRate   — fraction of documents whose parent index job reached
//                 'done' (fully embedded). 1 when there are no documents,
//                 so an empty project reads as 100% rather than NaN.
//
// Note on embedRate: interview_chunks.embedding is NOT NULL, so every chunk
// row is embedded by construction — a chunk-level embed rate is always 100%
// and meaningless. The honest signal is document-level: how many uploaded
// files finished indexing. A file mid-indexing pulls the rate below 100%.
//
// Scope: org_id (matching has_org_role RLS on interview_documents /
// interview_chunks) + project_id, mirroring the documents route.

type DocRow = {
  id: string;
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
    return NextResponse.json({ fileCount: 0, chunkCount: 0, embedRate: 1 });
  }

  // Documents + their parent job status, to derive fileCount and embedRate.
  const { data: docData, error: docErr } = await supabase
    .from('interview_documents')
    .select('id, interview_jobs(index_status)')
    .eq('org_id', org.org_id)
    .eq('project_id', id)
    .limit(1_000);

  if (docErr) {
    console.error('[interviews/v2/projects/:id/trust-stats] docs error', docErr);
    return NextResponse.json({ error: 'stats_failed' }, { status: 500 });
  }

  const docs = (docData ?? []) as unknown as DocRow[];
  const fileCount = docs.length;
  const doneCount = docs.filter(
    (d) => d.interview_jobs?.index_status === 'done',
  ).length;
  const embedRate = fileCount === 0 ? 1 : doneCount / fileCount;

  // Chunk count scoped to this project's documents. interview_chunks has no
  // project_id, so filter by the document ids gathered above.
  let chunkCount = 0;
  const docIds = docs.map((d) => d.id);
  if (docIds.length > 0) {
    const { count, error: chunkErr } = await supabase
      .from('interview_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.org_id)
      .in('document_id', docIds);
    if (chunkErr) {
      console.error(
        '[interviews/v2/projects/:id/trust-stats] chunks error',
        chunkErr,
      );
      return NextResponse.json({ error: 'stats_failed' }, { status: 500 });
    }
    chunkCount = count ?? 0;
  }

  return NextResponse.json({ fileCount, chunkCount, embedRate });
}
