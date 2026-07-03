import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — trust-badge summary stats for one interview_project.
//
// Backs the static <TrustBadgeStrip /> under the file list in the V2
// project-detail view (trust-badge option A). Returns a compact snapshot
// the user can read without any interaction:
//   file_count  — uploaded files attached to this project
//   chunk_count — indexed chunks across those files
//   embed_rate  — always 1.0: the V2 indexing pipeline marks the parent
//                 interview_jobs.index_status = 'error' on any embedding
//                 failure rather than persisting partial chunks, so every
//                 chunk that exists is embedded.
//
// Scope: org_id (matching the has_org_role RLS on interview_documents /
// interview_chunks) + project_id — same ownership model as the sibling
// documents route. interview_chunks has no project_id, so we resolve the
// project's document ids first and count chunks by document_id with a
// two-step query (avoids the PostgREST transitive-embed 0-rows pitfall,
// PROJECT.md §7.10).

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
    return NextResponse.json({ file_count: 0, chunk_count: 0, embed_rate: 1 });
  }

  const { data: docs, error: docErr } = await supabase
    .from('interview_documents')
    .select('id')
    .eq('org_id', org.org_id)
    .eq('project_id', id)
    .limit(1000);

  if (docErr) {
    console.error('[interviews/v2/projects/:id/trust-stats] docs error', docErr);
    return NextResponse.json({ error: 'stats_failed' }, { status: 500 });
  }

  const docIds = (docs ?? []).map((d) => d.id as string);
  const fileCount = docIds.length;

  let chunkCount = 0;
  if (docIds.length > 0) {
    const { count, error: chunkErr } = await supabase
      .from('interview_chunks')
      .select('id', { count: 'exact', head: true })
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

  return NextResponse.json({
    file_count: fileCount,
    chunk_count: chunkCount,
    embed_rate: 1,
  });
}
