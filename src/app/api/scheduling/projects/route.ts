import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSchedulingAccess } from '@/lib/scheduling/access';

// Projects are the top layer above scheduling batches (=groups) (PR-C). List +
// create, open to super-admin OR org member. Non-members get 404 (route stays
// unobservable). Org members are tenancy-scoped: the list is filtered to
// owner_user_ids that share an org with them, and a create is owned by them.
export async function GET() {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  let q = admin.from('sched_projects').select('id, title, share_token, created_at');
  if (!access.superadmin) q = q.in('owner_user_id', access.ownerUserIds);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { projects: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const title =
    body &&
    typeof body === 'object' &&
    typeof (body as { title?: unknown }).title === 'string'
      ? (body as { title: string }).title.trim()
      : '';
  if (!title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_projects')
    .insert({ owner_user_id: access.userId, title })
    .select('id, title, share_token, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json(
    { project: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
