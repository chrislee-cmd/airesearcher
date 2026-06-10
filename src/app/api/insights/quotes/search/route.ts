import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 15;

const LIMIT = 50;

const Body = z.object({
  jobId: z.string().uuid(),
  q: z.string().trim().min(1).max(500),
  // Opaque cursor — last row's id from the previous page. We use id-desc
  // pagination because insights_quotes.id is a monotonic bigint identity,
  // so it doubles as a stable insertion-order cursor without needing a
  // composite (created_at, id) tuple.
  cursor: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { jobId, q, cursor } = parsed.data;

  // RLS on insights_quotes already scopes rows to the caller's
  // organization via the org_members join, so we don't need an explicit
  // org check here — the eq(job_id) is enough to namespace within the
  // already-filtered visible rows.
  let query = supabase
    .from('insights_quotes')
    .select(
      'id, participant_name, theme, sentiment, text, source_file, source_offset',
    )
    .eq('job_id', jobId)
    .textSearch('tsv', q, { config: 'simple', type: 'websearch' })
    .order('id', { ascending: false })
    .limit(LIMIT + 1);

  if (cursor !== undefined) {
    query = query.lt('id', cursor);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'query_failed', detail: error.message },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  // We fetched LIMIT+1 to know whether a next page exists without a
  // separate count(*) call. Trim the sentinel before returning.
  const hasMore = rows.length > LIMIT;
  const page = hasMore ? rows.slice(0, LIMIT) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return NextResponse.json({ quotes: page, nextCursor });
}
