import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

// Rename a scheduling batch (super-admin only). Drives the calendar view's
// inline free-text title (PR-B) — the title doubles as the calendar heading, so
// it saves immediately on blur/Enter. Mirrors the /api/admin/* gate: non-admins
// get 404 and the write goes through the service-role client after the
// code-level isSuperAdminEmail check.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
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
