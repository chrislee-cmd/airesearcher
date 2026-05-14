import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Persists a completed interview analysis snapshot so the dashboard can
// list past runs and the user can return to a result after a refresh.
// The provider stays in-memory for the live pipeline; this endpoint is
// only called once analysis succeeds.

const InputItem = z.object({
  filename: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  mime: z.string().optional(),
});

const Body = z.object({
  project_id: z.string().uuid().nullable().optional(),
  inputs: z.array(InputItem),
  extractions: z.unknown(),
  matrix: z.unknown(),
  // Optional at initial persist: vertical-synthesis insights arrive
  // a few seconds after the raw matrix. If absent, the client follows
  // up with PATCH /api/interviews/jobs/[id] once consolidated lands.
  consolidated: z.unknown().optional(),
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
  const { project_id, inputs, extractions, matrix, consolidated } = parsed.data;

  const { data, error } = await supabase
    .from('interview_jobs')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      user_id: user.id,
      inputs,
      extractions,
      matrix,
      consolidated: consolidated ?? null,
      status: 'done',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[interviews/jobs] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
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
    .from('interview_jobs')
    .select('id, project_id, status, inputs, created_at, updated_at')
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) {
    console.error('[interviews/jobs] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [] });
}
