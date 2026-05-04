import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const { data, error } = await supabase
    .from('desk_jobs')
    .select(
      'id, keywords, sources, locale, date_from, date_to, status, progress, similar_keywords, output, articles, skipped, error_message, generation_id, created_at, updated_at',
    )
    .eq('id', id)
    .eq('org_id', org.org_id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ job: data });
}
