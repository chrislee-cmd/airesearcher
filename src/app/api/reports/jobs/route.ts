import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Persists a finished report so the dashboard can list past runs and the
// user can come back to a generated HTML after a refresh. Live pipeline
// state stays in the Workspace artifact + GenerationJob memory; only the
// completed result lands here.

const InputItem = z.object({
  filename: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  mime: z.string().optional(),
});

const Body = z.object({
  project_id: z.string().uuid().nullable().optional(),
  inputs: z.array(InputItem),
  markdown: z.string(),
  html: z.string(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { project_id, inputs, markdown, html } = parsed.data;

  const { data, error } = await supabase
    .from('report_jobs')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      user_id: user.id,
      inputs,
      markdown,
      html,
      status: 'done',
      head_version: 0,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[reports/jobs] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  // Mirror v0 into the version tree so subsequent enhance passes have a
  // parent to read from. Best-effort: failure here doesn't break the user
  // flow, but the report won't be enhance-able until v0 exists. We log it
  // loudly so operators notice.
  const { error: vErr } = await supabase.from('report_versions').insert({
    report_id: data.id,
    version: 0,
    parent_version: null,
    enhancement: null,
    markdown,
    html,
    context_payload: null,
    credits_spent: 0,
    created_by: user.id,
  });
  if (vErr) {
    console.error('[reports/jobs] v0 mirror failed', vErr);
  }

  return NextResponse.json({ id: data.id });
}

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
    return NextResponse.json({ jobs: [] });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);

  let query = supabase
    .from('report_jobs')
    .select('id, project_id, status, inputs, created_at, updated_at')
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) {
    console.error('[reports/jobs] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [] });
}
