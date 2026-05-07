import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

const FEATURE_TO_TABLE: Record<string, string> = {
  report: 'report_jobs',
  interview: 'interview_jobs',
  transcript: 'transcript_jobs',
  desk: 'desk_jobs',
  scheduler: 'scheduler_sessions',
};

const Body = z.object({
  feature: z.enum(['report', 'interview', 'transcript', 'desk', 'scheduler']),
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ error: 'no_org' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { feature, id, project_id } = parsed.data;
  const table = FEATURE_TO_TABLE[feature];

  if (project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const { error } = await supabase
    .from(table)
    .update({ project_id })
    .eq('id', id)
    .eq('org_id', org.org_id);

  if (error) {
    console.error('[artifacts/assign] update error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
