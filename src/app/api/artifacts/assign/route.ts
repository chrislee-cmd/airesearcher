import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// recruiting_forms uses `form_id text primary key` — every other table
// keys on a uuid `id` column. The id-column override below keeps the
// callers free of that detail.
type AssignTarget = {
  table: string;
  idColumn: string;
  // recruiting_forms predates org-scoping; older rows have no org_id.
  // For recruiting we still scope writes by user_id to stay safe.
  scopeColumn: 'org_id' | 'user_id';
};

const FEATURES: Record<string, AssignTarget> = {
  report: { table: 'report_jobs', idColumn: 'id', scopeColumn: 'org_id' },
  interview: { table: 'interview_jobs', idColumn: 'id', scopeColumn: 'org_id' },
  transcript: { table: 'transcript_jobs', idColumn: 'id', scopeColumn: 'org_id' },
  desk: { table: 'desk_jobs', idColumn: 'id', scopeColumn: 'org_id' },
  scheduler: { table: 'scheduler_sessions', idColumn: 'id', scopeColumn: 'org_id' },
  recruiting: { table: 'recruiting_forms', idColumn: 'form_id', scopeColumn: 'user_id' },
};

const Body = z.object({
  feature: z.enum([
    'report',
    'interview',
    'transcript',
    'desk',
    'scheduler',
    'recruiting',
  ]),
  // recruiting form ids are Google API strings, not uuids
  id: z.string().min(1),
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
  const target = FEATURES[feature];

  if (project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const scopeValue = target.scopeColumn === 'org_id' ? org.org_id : user.id;
  const { error } = await supabase
    .from(target.table)
    .update({ project_id })
    .eq(target.idColumn, id)
    .eq(target.scopeColumn, scopeValue);

  if (error) {
    console.error('[artifacts/assign] update error', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
