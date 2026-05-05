import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ jobs: [] });

  const { data, error } = await supabase
    .from('desk_jobs')
    .select(
      'id, keywords, sources, locale, date_from, date_to, status, progress, similar_keywords, output, articles, analytics, skipped, error_message, generation_id, created_at, updated_at',
    )
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [] });
}
