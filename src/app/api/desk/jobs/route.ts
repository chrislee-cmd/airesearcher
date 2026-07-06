import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { cleanupStaleDeskJobs } from '@/lib/desk-cleanup';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ jobs: [] });

  // Fire-and-forget: sweep jobs the function killed past maxDuration.
  // Realtime broadcasts the cleanup state on the next tick.
  void cleanupStaleDeskJobs(org.org_id);

  // List stays light on purpose — output/articles/analytics/research_questions/
  // claims/rq_answers are 100KB~1MB JSON per row, and 20 full rows (~10MB) was
  // pushing this query past 36s into Vercel 500 timeouts (2026-07-05 incident).
  // Heavy columns come from the per-job detail endpoint (/api/desk/jobs/[id]).
  const { data, error } = await supabase
    .from('desk_jobs')
    .select(
      'id, keywords, mode, sources, locale, date_from, date_to, status, progress, similar_keywords, skipped, error_message, generation_id, cancel_requested, created_at, updated_at',
    )
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [] });
}
