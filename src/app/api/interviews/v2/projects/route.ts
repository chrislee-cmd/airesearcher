import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Interview V2 — interview_projects CRUD (collection endpoint).
//
// V2 groups interview documents under a project. This handler backs the
// project picker/list in the V2 widget shell. Ownership is enforced twice:
// RLS ("own project rw", user_id = auth.uid()) on the table, and an
// explicit user_id filter / user_id column on write here so a stray org
// context can never leak another user's rows.

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
});

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
    return NextResponse.json({ projects: [] });
  }

  // archived 필터: '0' = 활성만(default) · '1' = 보관만 · 'all' = 전체.
  // 보관 = archived_at 이 채워진 row (soft delete). 그 외 값은 default 로 취급.
  const archivedParam = new URL(req.url).searchParams.get('archived') ?? '0';

  let query = supabase
    .from('interview_projects')
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .eq('user_id', user.id);

  if (archivedParam === '1') query = query.not('archived_at', 'is', null);
  else if (archivedParam !== 'all') query = query.is('archived_at', null);

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[interviews/v2/projects] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json({ projects: data ?? [] });
}

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

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { name, description } = parsed.data;

  const { data, error } = await supabase
    .from('interview_projects')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      name,
      description: description ?? null,
    })
    .select('id, name, description, tags, archived_at, created_at, updated_at')
    .single();

  if (error) {
    console.error('[interviews/v2/projects] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ project: data });
}
