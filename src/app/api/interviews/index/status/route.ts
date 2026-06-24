import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Cheap polling endpoint for the corpus-indexing status chip. Returns
// the job's index_status plus tally counts so the UI can render
// "코퍼스 인덱싱: 진행 중 (3 문서, 124 청크)" without a second round trip.
//
// Authn + org membership gate the read; the per-org counts come from
// the same RLS view the client would see directly.

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
  }

  const { data: job, error } = await supabase
    .from('interview_jobs')
    .select('id, index_status')
    .eq('id', jobId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // count: 'exact' with head: true returns just the row count in the
  // Content-Range header — no payload, cheaper than SELECT count(*).
  const [{ count: documentCount }, { count: chunkCount }] = await Promise.all([
    supabase
      .from('interview_documents')
      .select('id', { count: 'exact', head: true })
      .eq('interview_job_id', jobId),
    supabase
      .from('interview_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('interview_job_id', jobId),
  ]);

  return NextResponse.json({
    status: job.index_status as 'pending' | 'indexing' | 'done' | 'error',
    document_count: documentCount ?? 0,
    chunk_count: chunkCount ?? 0,
  });
}
