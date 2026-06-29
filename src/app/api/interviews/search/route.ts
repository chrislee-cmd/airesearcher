import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// pg_trgm substring search over interview_chunks for the full-view
// search panel. Parallel to /api/insights/quotes/search — pg_trgm GIN
// (migration 20260629015123) backs ILIKE matching, which is language-
// agnostic and avoids the 'simple' tsvector Korean under-recall trap
// (PROJECT.md §7.13).

export const maxDuration = 15;

const LIMIT = 50;

const Body = z.object({
  jobId: z.string().uuid(),
  q: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
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

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { jobId, q } = parsed.data;

  // Confirm the job belongs to the requester's org. Same shape as
  // /api/interviews/chat — gives a 404 instead of leaking job existence
  // through an empty rows response.
  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  const { data, error } = await supabase.rpc('search_interview_chunks', {
    p_job_id: jobId,
    p_q: q,
    p_limit: LIMIT,
  });
  if (error) {
    return NextResponse.json(
      { error: 'query_failed', detail: error.message },
      { status: 500 },
    );
  }

  type Row = {
    chunk_id: number | string;
    document_id: string;
    content: string;
    metadata: {
      filename?: string;
      heading_path?: string[];
      is_quote?: boolean;
    } | null;
  };
  const rows = (data ?? []) as Row[];
  const hits = rows.map((r) => {
    const meta = r.metadata ?? {};
    return {
      chunk_id:
        typeof r.chunk_id === 'string' ? Number(r.chunk_id) : r.chunk_id,
      document_id: r.document_id,
      content: r.content,
      filename: typeof meta.filename === 'string' ? meta.filename : '',
      heading_path: Array.isArray(meta.heading_path) ? meta.heading_path : [],
      is_quote: meta.is_quote === true,
    };
  });

  return NextResponse.json({ hits });
}
