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

  // Substring (pg_trgm) search via RPC. The earlier textSearch path on
  // the 'simple' tsv config dropped every Korean compound/조사 form
  // ("광고는" never matched "광고" because 'simple' tokenizes on
  // whitespace only — no morphology), so "광고" returned 7 rows on a
  // 71-quote dataset where the actual recall was much higher. ILIKE
  // backed by trigram GIN indexes (0027) catches all substring matches
  // and is language-agnostic. RLS still scopes via security invoker.
  const { data, error } = await supabase.rpc('search_insights_quotes', {
    p_job_id: jobId,
    p_q: q,
    p_cursor: cursor ?? null,
    p_limit: LIMIT,
  });
  if (error) {
    return NextResponse.json(
      { error: 'query_failed', detail: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Array<{
    id: number;
    participant_name: string;
    theme: string | null;
    sentiment: number | null;
    text: string;
    source_file: string | null;
    source_offset: number | null;
  }>;
  // We fetched LIMIT+1 to know whether a next page exists without a
  // separate count(*) call. Trim the sentinel before returning.
  const hasMore = rows.length > LIMIT;
  const page = hasMore ? rows.slice(0, LIMIT) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return NextResponse.json({ quotes: page, nextCursor });
}
