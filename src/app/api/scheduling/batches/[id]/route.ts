import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfBatch,
  ownerAllowed,
} from '@/lib/scheduling/access';

// Rename a scheduling batch. Open to super-admin OR org member; non-members get
// 404. Org members may only rename a batch whose owner shares an org with them
// (tenancy scoping). The title doubles as the calendar heading (PR-B).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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
  if (!access.superadmin) {
    const owner = await ownerOfBatch(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
    }
  }
  const { data, error } = await admin
    .from('sched_batches')
    .update({ title })
    .eq('id', id)
    .select('id, title, created_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'batch_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { batch: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
